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

export async function createTestDatabase() {
  const db = await PGlite.create({ extensions: { vector, cube, earthdistance } });

  const files = readdirSync(migrationsDir).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  // Minimal pg.Pool / pg.Client lookalike
  const client = {
    query: (text, params) => db.query(text, params),
    release: () => {},
  };
  const pool = {
    ...client,
    connect: async () => client,
    end: () => db.close(),
  };

  return { db, pool };
}
