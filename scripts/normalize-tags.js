/**
 * Normalize tags on every place and event to the controlled vocabulary
 * in api/_lib/tags.js ("date night" -> "date-night", "kids" -> "kid-friendly", ...)
 *
 * Usage:
 *   node scripts/normalize-tags.js           # dry run: show what would change
 *   node scripts/normalize-tags.js --apply   # write the changes
 *
 * Safe to run repeatedly.
 */

import { fileURLToPath } from 'url';
import { normalizeTags } from '../api/_lib/tags.js';

const sameTags = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

export async function normalizeAllTags(pool, { apply = false, log = console.log } = {}) {
  const summary = {};

  for (const table of ['places', 'events']) {
    const label = table === 'places' ? 'name' : 'title';
    const { rows } = await pool.query(`SELECT id, ${label} AS label, tags FROM ${table} WHERE tags IS NOT NULL`);
    let changed = 0;

    for (const row of rows) {
      const before = row.tags || [];
      const after = normalizeTags(before);
      if (sameTags(before, after)) continue;

      changed++;
      log(`${table} #${row.id} ${row.label}: [${before.join(', ')}] -> [${after.join(', ')}]`);
      if (apply) {
        await pool.query(`UPDATE ${table} SET tags = $1 WHERE id = $2`, [after, row.id]);
      }
    }

    summary[table] = { checked: rows.length, changed };
  }

  return summary;
}

async function main() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
  const pg = (await import('pg')).default;

  const apply = process.argv.includes('--apply');
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const summary = await normalizeAllTags(pool, { apply });
    console.log('\n', summary);
    console.log(apply ? '✅ Tags updated' : 'ℹ️  Dry run. Re-run with --apply to write changes.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('❌ Tag normalization failed:', err);
    process.exit(1);
  });
}
