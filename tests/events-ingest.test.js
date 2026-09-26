import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  parseICS,
  inferTags,
  toEventRows,
  getFeeds,
  ingestFeeds,
} from '../api/_lib/events-ingest.js';
import { createTestDatabase } from './helpers/pglite.js';

const NOW = new Date('2026-09-25T17:00:00Z'); // Friday noon in Madison

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:jazz-1',
  'SUMMARY:Jazz on the Terrace',
  'DESCRIPTION:Live music by the lake\\, free admission.\\nBring a',
  '  blanket.',
  'DTSTART;TZID=America/Chicago:20260925T190000',
  'DTEND;TZID=America/Chicago:20260925T210000',
  'LOCATION:Memorial Union Terrace\\, 800 Langdon St',
  'URL:https://isthmus.com/events/jazz-1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:fair-1',
  'SUMMARY:Harvest Fair',
  'DTSTART;VALUE=DATE:20260926',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled-1',
  'SUMMARY:Cancelled Show',
  'STATUS:CANCELLED',
  'DTSTART:20260926T010000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:past-1',
  'SUMMARY:Yesterday',
  'DTSTART:20260924T010000Z',
  'DTEND:20260924T030000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseICS', () => {
  it('unfolds lines, unescapes text and reads Madison times', () => {
    const [jazz, fair] = parseICS(ICS);
    expect(jazz.description).toBe('Live music by the lake, free admission.\nBring a blanket.');
    expect(jazz.location).toBe('Memorial Union Terrace, 800 Langdon St');
    expect(jazz.startTime.toISOString()).toBe('2026-09-26T00:00:00.000Z'); // 7pm CDT
    expect(fair.allDay).toBe(true);
  });
});

describe('inferTags', () => {
  it('uses whole words, so "party" is not art and "update" is not a date', () => {
    expect(inferTags('Block party update')).toEqual(['general']);
  });

  it('maps categories onto the vocabulary', () => {
    const tags = inferTags('Jazz on the Terrace', 'Live music, free admission');
    expect(tags).toEqual(expect.arrayContaining(['music', 'friend-hangout', 'free']));
    expect(inferTags('Toddler Storytime')).toContain('kid-friendly');
  });
});

describe('toEventRows', () => {
  it('drops cancelled and past events and gives all-day events a full day', () => {
    const rows = toEventRows(parseICS(ICS), 'isthmus', NOW);
    expect(rows.map(r => r.title)).toEqual(['Jazz on the Terrace', 'Harvest Fair']);
    const fair = rows[1];
    expect(new Date(fair.end_time) - new Date(fair.start_time)).toBe(24 * 60 * 60 * 1000);
  });

  it('drops events marked cancelled in the title, but not shows named "Cancelled"', () => {
    const at = new Date(NOW.getTime() + 60 * 60 * 1000);
    const rows = toEventRows([
      { title: 'CANCELED -- One-on-One Computer Assistance', startTime: at },
      { title: '[Postponed] Book Club', startTime: at },
      { title: 'Cancelled: A Comedy Night', startTime: at },
      { title: 'Cancelled', startTime: at },
      { title: 'Cancelled Plans Film Series', startTime: at },
    ], 'mpl', NOW);
    expect(rows.map(r => r.title)).toEqual(['Cancelled', 'Cancelled Plans Film Series']);
  });
});

describe('getFeeds', () => {
  it('adds valid EXTRA_ICS_FEEDS and ignores junk', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const feeds = getFeeds({
      EXTRA_ICS_FEEDS: JSON.stringify([
        { source: 'mpl', name: 'Library', url: 'https://example.org/mpl.ics' },
        { source: 'Bad Source', url: 'https://example.org/x.ics' },
        { source: 'insecure', url: 'http://example.org/x.ics' },
      ]),
    });
    expect(feeds.map(f => f.source)).toEqual(['isthmus', 'mpl']);
    expect(getFeeds({ EXTRA_ICS_FEEDS: 'not json' }).map(f => f.source)).toEqual(['isthmus']);
  });
});

describe('ingestFeeds (real Postgres)', () => {
  let pool;
  const feeds = [
    { source: 'isthmus', name: 'Isthmus', url: 'https://isthmus.test/cal.ics' },
    { source: 'library', name: 'Library', url: 'https://library.test/cal.ics' },
    { source: 'broken', name: 'Broken', url: 'https://broken.test/cal.ics' },
  ];
  const libraryICS = ICS
    .replace('UID:jazz-1', 'UID:lib-jazz')
    .replace('UID:fair-1', 'UID:lib-knitting')
    .replace('SUMMARY:Harvest Fair', 'SUMMARY:Knitting Circle');

  let isthmusBody = ICS;
  const fakeFetch = async (url) => {
    if (url.includes('broken')) return { ok: false, status: 404, text: async () => '' };
    const body = url.includes('library') ? libraryICS : isthmusBody;
    return { ok: true, status: 200, text: async () => body };
  };
  const run = () => ingestFeeds(pool, { feeds, fetchImpl: fakeFetch, now: NOW, log: () => {} });

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
  }, 60000);

  it('saves events, skips cross-source duplicates, and survives a broken feed', async () => {
    const [isthmus, library, broken] = await run();

    expect(isthmus).toMatchObject({ ok: true, inserted: 2, updated: 0 });
    // Jazz is already listed by Isthmus at the same time; knitting is new
    expect(library).toMatchObject({ ok: true, inserted: 1, duplicates: 1 });
    expect(broken).toMatchObject({ ok: false });

    const { rows } = await pool.query(
      "SELECT title, tags, vibe_active, is_free FROM events WHERE source = 'isthmus' ORDER BY start_time"
    );
    expect(rows[0].title).toBe('Jazz on the Terrace');
    expect(rows[0].tags).toEqual(expect.arrayContaining(['music', 'friend-hangout']));
    expect(rows[0].is_free).toBe(true);
    expect(Number(rows[0].vibe_active)).toBeGreaterThan(0.5);
  });

  it('updates in place on the next run and clears embeddings only when text changes', async () => {
    const vector = `[${new Array(1536).fill(0.01).join(',')}]`;
    await pool.query('UPDATE events SET embedding = $1::vector', [vector]);

    isthmusBody = ICS.replace('SUMMARY:Harvest Fair', 'SUMMARY:Harvest Fair (Rain Date)');
    const [isthmus] = await run();
    expect(isthmus).toMatchObject({ inserted: 0, updated: 2 });

    const { rows } = await pool.query(
      "SELECT title, embedding IS NULL AS cleared FROM events WHERE source = 'isthmus' ORDER BY start_time"
    );
    expect(rows).toEqual([
      { title: 'Jazz on the Terrace', cleared: false },
      { title: 'Harvest Fair (Rain Date)', cleared: true },
    ]);
  });
});

describe('activities view', () => {
  it('keeps events visible while they are still running', async () => {
    const { pool } = await createTestDatabase();
    await pool.query(`
      INSERT INTO events (city_id, title, slug, start_time, end_time, source, source_id)
      SELECT id, 'All-day Fair', 'fair', NOW() - INTERVAL '5 hours', NOW() + INTERVAL '5 hours', 'test', 'fair'
      FROM cities WHERE slug = 'madison'
    `);
    await pool.query(`
      INSERT INTO events (city_id, title, slug, start_time, end_time, source, source_id)
      SELECT id, 'Over', 'over', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '1 hour', 'test', 'over'
      FROM cities WHERE slug = 'madison'
    `);
    const { rows } = await pool.query("SELECT title FROM activities WHERE type = 'event'");
    expect(rows.map(r => r.title)).toEqual(['All-day Fair']);
  }, 60000);
});
