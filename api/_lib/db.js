/**
 * Shared database connection for Vercel serverless functions
 * Uses connection pooling with environment variables from Vercel Postgres
 */

import pg from 'pg';

const { Pool } = pg;

// Create a single pool instance that will be reused across function invocations
let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      // POSTGRES_URL on Vercel; DATABASE_URL for local dev and GitHub Actions
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}
