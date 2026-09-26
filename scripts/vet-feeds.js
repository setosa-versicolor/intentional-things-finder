/**
 * Check ICS feeds without touching the database
 *
 *   node scripts/vet-feeds.js                      # configured feeds
 *   node scripts/vet-feeds.js https://example.com/calendar.ics
 *
 * Prints how many upcoming events each feed has and a few sample titles,
 * so a new feed can be vetted before adding it to EXTRA_ICS_FEEDS.
 */

import { fetchFeed, getFeeds, parseICS, toEventRows } from '../api/_lib/events-ingest.js';

const urls = process.argv.slice(2);
const feeds = urls.length > 0
  ? urls.map((url, i) => ({ source: `check-${i}`, name: url, url }))
  : getFeeds();

for (const feed of feeds) {
  try {
    const parsed = parseICS(await fetchFeed(feed.url));
    const rows = toEventRows(parsed, feed.source);
    console.log(`✅ ${feed.name}: ${parsed.length} events, ${rows.length} upcoming`);
    for (const row of rows.slice(0, 5)) {
      console.log(`   ${row.start_time}  ${row.title}  [${row.tags.join(', ')}]`);
    }
  } catch (err) {
    console.log(`❌ ${feed.name}: ${err.message}`);
    process.exitCode = 1;
  }
}
