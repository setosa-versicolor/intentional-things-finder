/**
 * Database Migration Script for Vercel Postgres
 *
 * Run this after setting up Vercel Postgres:
 * node scripts/migrate-database.js
 */

import pg from 'pg';
import { readFileSync } from 'fs';
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
    // Read migration files
    const schema = readFileSync(
      join(__dirname, '../migrations/001_initial_schema 2.sql'),
      'utf8'
    );
    const seedData = readFileSync(
      join(__dirname, '../migrations/002_seed_madison_places.sql'),
      'utf8'
    );

    console.log('📋 Running schema migration...');
    await pool.query(schema);
    console.log('✅ Schema created successfully\n');

    console.log('🌱 Seeding Madison places...');
    await pool.query(seedData);
    console.log('✅ Seed data inserted successfully\n');

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
