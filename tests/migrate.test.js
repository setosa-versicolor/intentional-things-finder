import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { getStatus, migrate, listMigrations, describeTarget } from '../scripts/migrate.js';
import { createTestDatabase } from './helpers/pglite.js';

const upTo = (n) => (file) => parseInt(file, 10) <= n;
const quiet = { log: () => {} };
const statusMap = (statuses) => Object.fromEntries(statuses.map(s => [s.file.slice(0, 3), s.status]));

describe('migrate', () => {
  it('brings a database that only ever got 001-002 all the way up (the old Supabase case)', async () => {
    const { pool } = await createTestDatabase({ only: upTo(2) });

    const before = statusMap(await getStatus(pool));
    expect(before['001']).toBe('detected');
    expect(before['002']).toBe('detected');
    expect(before['003']).toBe('pending');
    expect(before['010']).toBe('pending');

    const { ran } = await migrate(pool, quiet);
    expect(ran[0]).toBe('003_add_vibe_active.sql');

    // Everything the API reads now exists
    await pool.query(`
      SELECT a.vibe_active, a.business_status, a.google_place_id, p.seasons
      FROM activities a LEFT JOIN places p ON a.type = 'place' AND p.id = a.id LIMIT 1
    `);
    expect(Object.values(statusMap(await getStatus(pool))).every(s => s !== 'pending')).toBe(true);
  }, 60000);

  it('only runs what is missing on a database that got 001-009 by hand (the Vercel/Neon case)', async () => {
    const { pool } = await createTestDatabase({ only: upTo(9) });
    // Hand-tuned data that must survive
    await pool.query("UPDATE places SET vibe_active = 0.95 WHERE slug = 'picnic-point'");

    const before = statusMap(await getStatus(pool));
    expect(Object.entries(before).filter(([, s]) => s === 'pending').map(([n]) => n)).toEqual(
      listMigrations().map(f => f.slice(0, 3)).filter(n => parseInt(n, 10) >= 10)
    );

    const { ran } = await migrate(pool, quiet);
    expect(ran[0]).toBe('010_keep_running_events_in_view.sql');

    const { rows } = await pool.query("SELECT vibe_active FROM places WHERE slug = 'picnic-point'");
    expect(Number(rows[0].vibe_active)).toBe(0.95);
  }, 60000);

  it('is a no-op the second time, and records how each migration was applied', async () => {
    const { pool } = await createTestDatabase({ only: upTo(2) });
    await migrate(pool, quiet);
    const again = await migrate(pool, quiet);
    expect(again.ran).toEqual([]);

    const { rows } = await pool.query('SELECT filename, method FROM schema_migrations ORDER BY filename');
    expect(rows[0]).toEqual({ filename: '001_initial_schema.sql', method: 'detected' });
    expect(rows.find(r => r.filename.startsWith('003')).method).toBe('ran');
  }, 60000);

  it('sets up an empty database from scratch', async () => {
    const { pool } = await createTestDatabase({ only: () => false });
    const { ran } = await migrate(pool, quiet);
    expect(ran).toEqual(listMigrations());
  }, 60000);

  it('rolls back a failing migration and stops', async () => {
    const { pool } = await createTestDatabase({ only: upTo(2) });
    // Sabotage: 003 adds this column, so it will fail
    await pool.query('ALTER TABLE events ADD COLUMN vibe_active NUMERIC');
    await expect(migrate(pool, quiet)).rejects.toThrow(/003_add_vibe_active\.sql failed and was rolled back/);

    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'places' AND column_name = 'vibe_active'"
    );
    expect(rows).toHaveLength(0);
  }, 60000);

  it('never prints credentials', () => {
    expect(describeTarget('postgresql://postgres:hunter2@db.example.supabase.co:6543/postgres?pgbouncer=true'))
      .toBe('db.example.supabase.co/postgres');
  });
});

describe('check-database.sql', () => {
  const sql = readFileSync(new URL('../scripts/sql/check-database.sql', import.meta.url), 'utf8');

  it('runs on an old database and on a current one', async () => {
    const old = (await createTestDatabase({ only: upTo(2) })).pool;
    const oldReport = Object.fromEntries((await old.query(sql)).rows.map(r => [r.check, r.result]));
    expect(oldReport['003 vibe_active']).toBe('false');
    expect(oldReport['places (active)']).toBe('8');

    const current = (await createTestDatabase()).pool;
    const report = Object.fromEntries((await current.query(sql)).rows.map(r => [r.check, r.result]));
    expect(report['003 vibe_active']).toBe('true');
    expect(report['010 running events in view']).toBe('true');
  }, 60000);
});
