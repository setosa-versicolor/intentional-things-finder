import { describe, it, expect, beforeAll } from 'vitest';
import { findPlacesNeedingSync } from '../scripts/sync-google-places.js';
import { createTestDatabase } from './helpers/pglite.js';

const good = { type: 'standard', periods: [{ open: { day: 1, time: '0700' }, close: { day: 1, time: '1800' } }] };
// What the old sync stored from Places API (New): day but no time
const broken = { type: 'standard', periods: [{ open: { day: 1 }, close: { day: 1 } }] };

describe('findPlacesNeedingSync (real Postgres)', () => {
  let pool;
  let ids;

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
    const { rows } = await pool.query('SELECT id FROM places ORDER BY id LIMIT 5');
    ids = rows.map(r => r.id);

    // Everything freshly synced with good hours...
    await pool.query(
      `UPDATE places SET google_place_id = 'gp-' || id, last_synced_at = NOW(), hours = $1::jsonb`,
      [JSON.stringify(good)]
    );
    // ...except these
    await pool.query('UPDATE places SET hours = $1::jsonb WHERE id = $2', [JSON.stringify(broken), ids[0]]);
    await pool.query(`UPDATE places SET hours = '{"type":"unknown","periods":[]}'::jsonb WHERE id = $1`, [ids[1]]);
    await pool.query('UPDATE places SET hours = NULL WHERE id = $1', [ids[4]]);
    await pool.query(`UPDATE places SET last_synced_at = NOW() - INTERVAL '30 days' WHERE id = $1`, [ids[2]]);
    await pool.query(`UPDATE places SET hours = '{"type":"always_open","always_open":true}'::jsonb WHERE id = $1`, [ids[3]]);
  }, 60000);

  it('picks up broken, missing and stale hours but not healthy, unknown or 24/7 places', async () => {
    const rows = await findPlacesNeedingSync(pool);
    expect(rows.map(r => r.id).sort()).toEqual([ids[0], ids[2], ids[4]].sort());
  });

  it('supports --all and --limit', async () => {
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM places WHERE is_active');
    expect(await findPlacesNeedingSync(pool, { all: true })).toHaveLength(n);
    expect(await findPlacesNeedingSync(pool, { limit: 2 })).toHaveLength(2);
  });
});
