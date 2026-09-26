/**
 * A real, in-process Postgres (PGlite) with every migration applied,
 * wrapped to look like a `pg` Pool so handlers can run against it.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * @param {Object} [options]
 * @param {(file: string) => boolean} [options.only] - which migrations to apply (default: all)
 */
export async function createTestDatabase({ only = () => true } = {}) {
  const db = await PGlite.create({ extensions: { vector, cube, earthdistance } });

  const files = readdirSync(migrationsDir).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
  for (const file of files.filter(only)) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  // Minimal pg.Pool / pg.Client lookalike. Like node-pg, a query without
  // parameters may contain several statements.
  const client = {
    query: async (text, params) => {
      if (params && params.length > 0) return db.query(text, params);
      const results = await db.exec(text);
      return results[results.length - 1] || { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    ...client,
    connect: async () => client,
    end: () => db.close(),
  };

  return { db, pool };
}
