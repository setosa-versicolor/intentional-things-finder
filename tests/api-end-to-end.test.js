/**
 * The real API handlers against a real (in-process) Postgres with every
 * migration applied. Only the network calls (OpenAI, NWS) are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/pglite.js';

let pool;
vi.mock('../api/_lib/db.js', () => ({ getPool: () => pool }));
vi.mock('../api/_lib/embeddings.js', () => ({ generatePreferenceEmbedding: async () => null }));
vi.mock('../api/_lib/weather.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHourlyForecast: async () => null,
}));

const { default: recommendations } = await import('../api/recommendations.js');
const { default: feedback } = await import('../api/feedback.js');

const call = async (handler, body, method = 'POST') => {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  await handler({ method, body }, res);
  return res;
};

const prefs = { timeAvailable: 240, quietToLively: 0.5, activeToRelaxing: 0.5, location: 'either', tags: [] };

describe('API against real Postgres', () => {
  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
    // Give every seeded place 7am-10pm hours so time of day is predictable
    const hours = { type: 'standard', periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, time: '0700' }, close: { day, time: '2200' } })) };
    await pool.query('UPDATE places SET hours = $1::jsonb', [JSON.stringify(hours)]);
  }, 60000);

  afterEach(() => vi.useRealTimers());

  it('recommends open places and logs the request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T17:00:00Z')); // noon in Madison

    const res = await call(recommendations, prefs);
    expect(res.statusCode).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.recommendations[0]).toHaveProperty('category');
    expect(res.body.metadata.recommendationId).toEqual(expect.any(Number));
    expect(res.body.metadata.conditions.sunset).toMatch(/^2026-07-02T01:/); // ~8:37pm CDT
  });

  it('returns nothing when every place is closed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-02T08:00:00Z')); // 3am in Madison

    const res = await call(recommendations, prefs);
    expect(res.statusCode).toBe(200);
    expect(res.body.recommendations).toEqual([]);
  });

  it('never suggests out-of-season places', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T17:00:00Z'));
    await pool.query("UPDATE places SET seasons = ARRAY['winter']");

    const res = await call(recommendations, prefs);
    expect(res.body.recommendations.filter(r => r.type === 'place')).toEqual([]);
    await pool.query('UPDATE places SET seasons = NULL');
  });

  it('records which suggestion was picked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T17:00:00Z'));
    const rec = await call(recommendations, prefs);
    const pick = rec.body.recommendations[0];
    const res = await call(feedback, {
      recommendationId: rec.body.metadata.recommendationId,
      selectedId: pick.id,
      selectedType: pick.type,
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query('SELECT selected_id, selected_type FROM recommendations WHERE id = $1', [rec.body.metadata.recommendationId]);
    expect(rows[0]).toEqual({ selected_id: pick.id, selected_type: pick.type });
  });
});

describe('API and event triage', () => {
  const eventSoon = (db, title, triage) => db.query(`
    INSERT INTO events (city_id, title, slug, start_time, end_time, vibe_quiet, vibe_inside, vibe_active, source, source_id, is_active)
    SELECT id, $1, $1, '2026-07-01T17:30:00Z', '2026-07-01T19:00:00Z', 0.5, 0.5, 0.5, 'test', $1, TRUE
    FROM cities WHERE slug = 'madison'
  `, [title]).then(() => triage && db.query('UPDATE events SET triage = $1::jsonb WHERE title = $2', [JSON.stringify(triage), title]));

  it('never suggests events triaged as filler, and keeps the reason out of the response', async () => {
    ({ pool } = await createTestDatabase());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T17:00:00Z'));
    await eventSoon(pool, 'Happy Hour Special', { score: 0.1, reason: 'drink special', tags: ['social'] });
    await eventSoon(pool, 'Author Reading', { score: 0.9, reason: 'notable author', tags: ['lectures'] });

    const res = await call(recommendations, { ...prefs, limit: 10 });
    const titles = res.body.recommendations.map(r => r.title);
    expect(titles).not.toContain('Happy Hour Special');
    expect(titles).toContain('Author Reading');
    expect(JSON.stringify(res.body)).not.toContain('notable author');
  }, 60000);
});
