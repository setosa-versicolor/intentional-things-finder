import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDatabase } from './helpers/pglite.js';

describe('migrations', () => {
  let pool;

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
  }, 60000);

  it('apply cleanly in order and seed Madison', async () => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM places p JOIN cities c ON c.id = p.city_id WHERE c.slug = 'madison'");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('expose the columns the API reads', async () => {
    const { rows } = await pool.query(`
      SELECT a.business_status, a.vibe_active, a.google_place_id, p.seasons, p.best_times
      FROM activities a LEFT JOIN places p ON a.type = 'place' AND p.id = a.id
      LIMIT 1
    `);
    expect(rows).toHaveLength(1);
  });
});
