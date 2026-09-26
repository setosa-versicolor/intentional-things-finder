/**
 * The API on a database that hasn't had migration 011 (event triage) yet.
 * Its own file so the handler's schema check starts fresh.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestDatabase } from './helpers/pglite.js';

let pool;
vi.mock('../api/_lib/db.js', () => ({ getPool: () => pool }));
vi.mock('../api/_lib/embeddings.js', () => ({ generatePreferenceEmbedding: async () => null }));
vi.mock('../api/_lib/weather.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHourlyForecast: async () => null,
}));

const { default: recommendations } = await import('../api/recommendations.js');

describe('API before migration 011', () => {
  it('still recommends events', async () => {
    ({ pool } = await createTestDatabase({ only: (f) => parseInt(f, 10) <= 10 }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T17:00:00Z'));
    await pool.query(`
      INSERT INTO events (city_id, title, slug, start_time, end_time, source, source_id)
      SELECT id, 'Street Fair', 'street-fair', '2026-07-01T17:30:00Z', '2026-07-01T19:00:00Z', 'test', 'fair'
      FROM cities WHERE slug = 'madison'
    `);

    const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await recommendations({
      method: 'POST',
      body: { timeAvailable: 240, quietToLively: 0.5, activeToRelaxing: 0.5, limit: 10 },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.recommendations.map(r => r.title)).toContain('Street Fair');
    vi.useRealTimers();
  }, 60000);
});
