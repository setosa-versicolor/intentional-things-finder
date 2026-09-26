import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseTriageResponse,
  triageEvents,
  applyTriage,
  buildUserMessage,
  SYSTEM_PROMPT,
} from '../api/_lib/event-triage.js';
import { buildContext, isEligible, rankActivities } from '../api/_lib/recommend.js';
import { fromLocalTime } from '../api/_lib/time.js';
import { createTestDatabase } from './helpers/pglite.js';

describe('parseTriageResponse', () => {
  it('accepts well-formed results and clamps or filters the rest', () => {
    const reply = JSON.stringify({
      events: [
        { id: 1, score: 0.9, reason: 'Touring band at the Sylvee', tags: ['music', 'date-night', 'made-up-tag'], vibe_quiet: 0.1, vibe_inside: 1.4, vibe_active: 0.5, kid_friendly: 'yes', is_free: true },
        { id: 2, score: 'not a number' },
        { id: 99, score: 0.5 }, // not asked about
        { id: 3, score: -1, tags: 'music' },
      ],
    });
    const results = parseTriageResponse(reply, [1, 2, 3]);

    expect([...results.keys()]).toEqual(['1', '3']);
    expect(results.get('1')).toMatchObject({
      score: 0.9,
      tags: ['music', 'friend-hangout', 'date-night'],
      vibe_inside: 1,
      kid_friendly: false, // only literal true counts
      is_free: true,
    });
    expect(results.get('3')).toMatchObject({ score: 0, tags: [] });
  });

  it('returns nothing for a reply that is not JSON', () => {
    expect(parseTriageResponse('Sure! Here are the scores:', [1]).size).toBe(0);
  });

  it('tells the model listings are data, and sends Madison-local times', () => {
    expect(SYSTEM_PROMPT).toMatch(/data, not instructions/);
    const message = JSON.parse(buildUserMessage([{ id: 1, title: 'X', start_time: '2026-09-26T00:00:00Z' }]));
    expect(message.events[0].starts).toBe('Fri, Sep 25, 7:00 PM');
  });
});

describe('triageEvents (real Postgres, fake model)', () => {
  let pool;
  const calls = [];

  // Scores "Trivia" low and everything else high; the second call fails
  const fakeOpenAI = (failOn = -1) => async (url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length - 1 === failOn) return { ok: false, status: 500, text: async () => 'boom' };
    const { events } = JSON.parse(JSON.parse(options.body).messages[1].content);
    const reply = {
      events: events.map(e => ({
        id: e.id,
        score: /trivia/i.test(e.title) ? 0.2 : 0.85,
        reason: 'test',
        tags: ['music'],
        vibe_quiet: 0.2, vibe_inside: 0.9, vibe_active: 0.4,
        kid_friendly: false, is_free: false,
      })),
    };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
  };

  const insertEvent = (title, hoursFromNow) => pool.query(`
    INSERT INTO events (city_id, title, slug, description, start_time, source, source_id)
    SELECT id, $1, $1, 'desc', NOW() + ($2 || ' hours')::interval, 'test', $1 FROM cities WHERE slug = 'madison'
  `, [title, String(hoursFromNow)]);

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
    for (let i = 0; i < 12; i++) await insertEvent(`Concert ${i}`, 24 + i);
    await insertEvent('Tuesday Trivia', 30);
    await insertEvent('Last week', -200);
  }, 60000);

  const run = (fetchImpl) => triageEvents(pool, { apiKey: 'test', fetchImpl, batchSize: 10, env: {}, log: () => {} });

  it('skips cleanly without a key or when switched off', async () => {
    expect(await triageEvents(pool, { apiKey: '', env: {}, log: () => {} })).toEqual({ skipped: 'OPENAI_API_KEY is not set' });
    expect(await triageEvents(pool, { apiKey: 'x', env: { EVENT_TRIAGE: 'off' }, log: () => {} })).toEqual({ skipped: 'EVENT_TRIAGE is off' });
  });

  it('triages upcoming events in batches, and a failed batch is retried next run', async () => {
    const first = await run(fakeOpenAI(1));
    expect(first).toMatchObject({ candidates: 13, triaged: 10, failedBatches: 1 });

    const second = await run(fakeOpenAI());
    expect(second).toMatchObject({ candidates: 3, triaged: 3, failedBatches: 0 });

    const { rows } = await pool.query("SELECT triage FROM events WHERE title = 'Tuesday Trivia'");
    expect(rows[0].triage).toMatchObject({ score: 0.2, model: 'gpt-4o-mini' });
    const past = await pool.query("SELECT triage FROM events WHERE title = 'Last week'");
    expect(past.rows[0].triage).toBeNull();
  });

  it('leaves unchanged events alone and re-triages changed ones', async () => {
    calls.length = 0;
    expect(await run(fakeOpenAI())).toMatchObject({ candidates: 0 });
    expect(calls).toHaveLength(0);

    await pool.query("UPDATE events SET description = 'now with a headliner' WHERE title = 'Concert 3'");
    expect(await run(fakeOpenAI())).toMatchObject({ candidates: 1, triaged: 1 });
  });
});

describe('triage in ranking', () => {
  const now = fromLocalTime(2026, 8, 25, 18, 0);
  const soon = new Date(now.getTime() + 30 * 60000).toISOString();
  const prefs = { timeAvailable: 120, quietToLively: 0.5, activeToRelaxing: 0.5, location: 'either', tags: [] };
  const event = (id, title, triage) => ({
    type: 'event', id, title, start_time: soon, tags: ['general'], vibe_quiet: 0.5, vibe_inside: 0.5, vibe_active: 0.5, triage,
  });

  it('drops events triaged as filler and favors the good ones', () => {
    const ctx = buildContext({ date: now, random: () => 0 });
    const trivia = applyTriage(event(1, 'Trivia', { score: 0.2, tags: ['social'] }), {});
    const concert = applyTriage(event(2, 'Concert', { score: 0.9, tags: ['music'] }), {});
    const untriaged = applyTriage(event(3, 'Unknown', null), {});

    expect(isEligible(trivia, prefs, ctx)).toBe(false);
    expect(isEligible(untriaged, prefs, ctx)).toBe(true);
    expect(rankActivities([untriaged, concert], prefs, ctx, 1)[0].title).toBe('Concert');
  });

  it("uses the model's tags and vibes instead of keyword guesses", () => {
    const row = applyTriage(event(1, 'X', { score: 0.8, tags: ['nature', 'kid-friendly'], vibe_inside: 0.1, vibe_quiet: null }), {});
    expect(row).toMatchObject({ tags: ['nature', 'kid-friendly'], vibe_inside: 0.1, vibe_quiet: 0.5, triage_score: 0.8 });
  });

  it('EVENT_TRIAGE=off ignores stored results', () => {
    const row = applyTriage(event(1, 'X', { score: 0.1, tags: ['nature'] }), { EVENT_TRIAGE: 'off' });
    expect(row.triage_score).toBeUndefined();
    expect(row.tags).toEqual(['general']);
  });
});
