/**
 * Sort upcoming events with a model (GitHub Actions, after scraping)
 *
 * Only new or changed events are sent. Results affect ranking only. See
 * api/_lib/event-triage.js. Disable with EVENT_TRIAGE=off.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { triageEvents } from '../api/_lib/event-triage.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  });

  try {
    const result = await triageEvents(pool);
    if (result.skipped) console.log(`ℹ️  Triage skipped: ${result.skipped}`);
  } catch (err) {
    console.error('❌ Triage failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
