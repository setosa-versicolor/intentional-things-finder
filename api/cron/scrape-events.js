/**
 * Vercel Cron Job: Daily Event Scraping
 * Runs daily (see vercel.json)
 *
 * Pulls every configured ICS feed (see api/_lib/events-ingest.js).
 * Protected by Vercel's cron secret.
 */

import { getPool } from '../_lib/db.js';
import { ingestFeeds } from '../_lib/events-ingest.js';

export default async function handler(req, res) {
  // Verify cron secret (Vercel provides this automatically)
  const authHeader = req.headers.authorization;
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const feeds = await ingestFeeds(getPool());
    const ok = feeds.some(feed => feed.ok);
    res.status(ok ? 200 : 502).json({ success: ok, feeds });
  } catch (err) {
    console.error('❌ Scraper failed:', err);
    res.status(500).json({ error: 'Scrape failed' });
  }
}
