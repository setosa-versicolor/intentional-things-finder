/**
 * Database Migration Script for Vercel Postgres
 *
 * Sets up a FRESH database by running every file in migrations/ in order.
 * Don't run this against a database that already has the schema.
 *
 * node scripts/migrate-database.js
 */

import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load .env.local first (Vercel env vars), then fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🚀 Starting database migration...\n');

  try {
    const migrationsDir = join(__dirname, '../migrations');
    const files = readdirSync(migrationsDir)
      .filter(f => /^\d{3}_.+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      console.log(`📋 Running ${file}...`);
      await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
    }
    console.log(`✅ Ran ${files.length} migrations\n`);

    // Verify
    const places = await pool.query('SELECT COUNT(*) FROM places');
    const cities = await pool.query('SELECT COUNT(*) FROM cities');

    console.log('📊 Migration complete!');
    console.log(`   - Cities: ${cities.rows[0].count}`);
    console.log(`   - Places: ${places.rows[0].count}`);
    console.log('\n✨ Database is ready for use!');

  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
