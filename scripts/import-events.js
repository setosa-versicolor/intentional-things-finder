/**
 * Import Events Script
 * Pulls every configured ICS feed into the database (same code as the
 * daily cron: api/_lib/events-ingest.js)
 *
 * node scripts/import-events.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { ingestFeeds } from '../api/_lib/events-ingest.js';

// Load .env.local first (Vercel env vars), then fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const results = await ingestFeeds(pool);
  if (!results.some(r => r.ok)) process.exitCode = 1;
} catch (err) {
  console.error('❌ Import failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
