/**
 * Database migrations, safe for databases with an unknown history
 *
 *   node scripts/migrate.js            # dry run: show what's applied and what would run
 *   node scripts/migrate.js --apply    # run pending migrations
 *
 * Connects to POSTGRES_URL, or DATABASE_URL if that's unset.
 *
 * Applied migrations are recorded in a schema_migrations table. For a
 * database that predates that table, each migration is checked against the
 * schema it would have created (a column, a view definition), so nothing is
 * run twice. Every pending migration runs in its own transaction: a failure
 * rolls that migration back and stops, leaving earlier ones in place.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

const hasColumn = (table, column) => async (db) => {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
};

const hasTable = (table) => async (db) => {
  const { rows } = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [table]);
  return rows[0].present;
};

const viewDefinitionMatches = (pattern) => async (db) => {
  if (!(await hasTable('activities')(db))) return false;
  const { rows } = await db.query("SELECT pg_get_viewdef('activities'::regclass) AS def");
  return pattern.test(rows[0].def);
};

/**
 * How to tell a migration already ran, for databases without schema_migrations.
 * Data-only migrations have no schema marker; they count as applied when the
 * schema migration they shipped with did.
 */
export const DETECTORS = {
  '001_initial_schema.sql': hasTable('places'),
  '002_seed_madison_places.sql': async (db) =>
    (await hasTable('places')(db)) && (await db.query('SELECT EXISTS (SELECT 1 FROM places) AS present')).rows[0].present,
  '003_add_vibe_active.sql': hasColumn('places', 'vibe_active'),
  '004_update_place_tags.sql': hasColumn('places', 'vibe_active'),
  '005_add_google_place_id.sql': hasColumn('places', 'google_place_id'),
  '006_add_place_id_to_view.sql': hasColumn('activities', 'google_place_id'),
  '007_add_business_status.sql': hasColumn('places', 'business_status'),
  '008_add_seasonal_filtering.sql': hasColumn('places', 'seasons'),
  '009_add_more_seasonal_restrictions.sql': hasColumn('places', 'seasons'),
  '010_keep_running_events_in_view.sql': viewDefinitionMatches(/coalesce\(\s*e\.end_time/i),
  '011_add_event_triage.sql': hasColumn('events', 'triage'),
};

export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
}

/**
 * Work out each migration's status without changing anything
 * @returns {Promise<Array<{file, status: 'applied'|'detected'|'pending'}>>}
 */
export async function getStatus(db, files = listMigrations()) {
  let recorded = new Set();
  if (await hasTable('schema_migrations')(db)) {
    const { rows } = await db.query('SELECT filename FROM schema_migrations');
    recorded = new Set(rows.map(r => r.filename));
  }

  // Check every marker against the database as it is now, before anything runs
  const statuses = [];
  for (const file of files) {
    if (recorded.has(file)) {
      statuses.push({ file, status: 'applied' });
    } else if (DETECTORS[file] && await DETECTORS[file](db)) {
      statuses.push({ file, status: 'detected' });
    } else {
      statuses.push({ file, status: 'pending' });
    }
  }
  return statuses;
}

/**
 * Record detected migrations and run pending ones in order
 */
export async function migrate(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const files = listMigrations(dir);
  const statuses = await getStatus(pool, files);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      method TEXT NOT NULL
    )
  `);

  for (const { file } of statuses.filter(s => s.status === 'detected')) {
    await pool.query(
      "INSERT INTO schema_migrations (filename, method) VALUES ($1, 'detected') ON CONFLICT DO NOTHING",
      [file]
    );
  }

  const ran = [];
  for (const { file } of statuses.filter(s => s.status === 'pending')) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, method) VALUES ($1, 'ran')",
        [file]
      );
      await client.query('COMMIT');
      log(`✅ ${file}`);
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed and was rolled back: ${err.message}`);
    } finally {
      client.release();
    }
  }

  return { statuses, ran };
}

/** "postgres://user:secret@host:5432/db" -> "host/db" */
export function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function main() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
  const pg = (await import('pg')).default;

  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ Set POSTGRES_URL or DATABASE_URL');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  console.log(`🗄️  Database: ${describeTarget(url)}\n`);

  try {
    const statuses = await getStatus(pool);
    const labels = { applied: '✔ applied', detected: '✔ already in schema', pending: '• pending' };
    for (const { file, status } of statuses) {
      console.log(`  ${labels[status].padEnd(20)} ${file}`);
    }

    const pending = statuses.filter(s => s.status === 'pending');
    if (!apply) {
      console.log(pending.length
        ? `\nℹ️  Dry run. ${pending.length} migration(s) would run. Re-run with --apply.`
        : '\n✅ Up to date.');
      return;
    }

    console.log('');
    const { ran } = await migrate(pool);
    console.log(ran.length ? `\n✅ Ran ${ran.length} migration(s).` : '\n✅ Up to date.');
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
