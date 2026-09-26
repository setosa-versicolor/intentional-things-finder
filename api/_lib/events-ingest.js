/**
 * Event ingestion from ICS calendar feeds
 *
 * Shared by the Vercel cron (api/cron/scrape-events.js) and the GitHub
 * Actions scraper (scrapers/isthmus-ics-scraper.js) so both write events
 * the same way.
 *
 * Embeddings are left to scrapers/generate-embeddings.js: an event whose
 * title or description changes has its embedding cleared so it gets
 * regenerated.
 */

import { parseICSDate } from './time.js';
import { normalizeTags } from './tags.js';

export const DEFAULT_FEEDS = [
  {
    source: 'isthmus',
    name: 'Isthmus calendar',
    url: 'https://isthmus.com/search/event/calendar-of-events/calendar.ics',
  },
];

const USER_AGENT = 'IntentionalThingsFinder/1.0 (+https://github.com/setosa-versicolor/intentional-things-finder)';

/**
 * Configured feeds: the defaults plus EXTRA_ICS_FEEDS, a JSON list like
 * [{"source":"mpl","name":"Madison Public Library","url":"https://..."}]
 */
export function getFeeds(env = process.env) {
  let extra = [];
  if (env.EXTRA_ICS_FEEDS) {
    try {
      extra = JSON.parse(env.EXTRA_ICS_FEEDS);
    } catch (err) {
      console.warn('⚠️  EXTRA_ICS_FEEDS is not valid JSON, ignoring it:', err.message);
    }
  }

  const valid = (Array.isArray(extra) ? extra : []).filter(feed =>
    feed && typeof feed.source === 'string' && /^[a-z0-9-]+$/.test(feed.source) &&
    typeof feed.url === 'string' && /^https:\/\//.test(feed.url)
  );

  const bySource = new Map([...DEFAULT_FEEDS, ...valid].map(feed => [feed.source, feed]));
  return [...bySource.values()];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const unescapeText = (value) => value
  .replace(/\\n/gi, '\n')
  .replace(/\\([,;\\])/g, '$1');

/**
 * Parse VEVENTs out of an ICS document
 */
export function parseICS(icsContent) {
  // Unfold continuation lines (RFC 5545: CRLF followed by a space or tab)
  const lines = String(icsContent).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;

    const [name, ...params] = line.substring(0, colon).split(';');
    const value = line.substring(colon + 1);

    switch (name.toUpperCase()) {
      case 'SUMMARY':
        current.title = unescapeText(value).trim();
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value).trim();
        break;
      case 'DTSTART':
        current.startTime = parseICSDate(value);
        current.allDay = params.some(p => p.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(value.trim());
        break;
      case 'DTEND':
        current.endTime = parseICSDate(value);
        break;
      case 'LOCATION':
        current.location = unescapeText(value).trim();
        break;
      case 'URL':
        current.url = value.trim();
        break;
      case 'UID':
        current.uid = value.trim();
        break;
      case 'STATUS':
        current.status = value.trim().toUpperCase();
        break;
      default:
        break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Categorizing
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  [/\b(music|concerts?|band|jazz|rock|dj|orchestra|symphony|choir|bluegrass|hip-hop|open mic)\b/, ['music', 'live-music']],
  [/\b(comedy|comedian|stand-?up|improv)\b/, ['comedy']],
  [/\b(art|arts|exhibits?|exhibition|gallery|painting|sculpture|photography)\b/, ['art']],
  [/\b(theaters?|theatres?|plays?|musical|opera|drama)\b/, ['theater', 'performing-arts']],
  [/\b(films?|movies?|cinema|screening)\b/, ['film']],
  [/\b(food|dinner|brunch|tasting|dining|chef|cuisine|fish fry|supper club|farmers'? market)\b/, ['food']],
  [/\b(kids?|family|families|children|toddlers?|storytime|story time)\b/, ['kid-friendly']],
  [/\b(outdoors?|nature|hike|hiking|garden|trail|paddle|kayak|bird(ing)?)\b/, ['outdoors']],
  [/\b(dance|dancing|ballet|swing|contra)\b/, ['dance', 'social']],
  [/\b(lectures?|talks?|seminars?|discussion|author|book reading|panel)\b/, ['lectures']],
  [/\b(crafts?|workshops?|diy|make your own)\b/, ['crafts']],
  [/\b(yoga|fitness|workout|5k|group ride)\b/, ['fitness']],
  [/\b(trivia|karaoke|game night|board games?)\b/, ['social']],
];

const FREE_PATTERN = /\b(free admission|free entry|free event|free and open|free to attend|no cover|no charge)\b/;

export function inferTags(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();
  const tags = [];

  for (const [pattern, categoryTags] of CATEGORY_RULES) {
    if (pattern.test(text)) tags.push(...categoryTags);
  }
  if (FREE_PATTERN.test(text) || /\bfree\b/.test(title.toLowerCase())) {
    tags.push('free');
  }

  return normalizeTags(tags.length > 0 ? tags : ['general']);
}

export function inferVibe(tags) {
  const has = (...names) => names.some(n => tags.includes(n));
  let quiet = 0.5;
  let inside = 0.5;
  let active = 0.5;

  if (has('music', 'dance', 'comedy', 'social', 'fitness')) {
    quiet = 0.2;
    active = 0.7;
  } else if (has('art', 'lectures', 'film')) {
    quiet = 0.7;
    active = 0.3;
  }

  if (has('outdoors')) {
    inside = 0.2;
    active = Math.max(active, 0.6);
  } else if (has('theater', 'film', 'lectures', 'art', 'crafts')) {
    inside = 0.9;
  }

  if (has('fitness') && /yoga|meditation/.test(tags.join(' '))) active = 0.2;

  return { quiet, inside, active };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

const truncate = (value, max) => (value && value.length > max ? value.slice(0, max) : value || null);

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Title key for spotting the same event listed by two sources */
export const dedupKey = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '');

const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Feeds that don't set STATUS mark it in the title: "CANCELED -- Book Club", "[Postponed] ..."
const CANCELLED_TITLE = /^\W*(cancel+ed|postponed)\s*(--|—|–|-|:|\])/i;

/**
 * Turn parsed ICS events into rows ready for the events table
 */
export function toEventRows(events, source, now = new Date()) {
  const rows = [];
  const seen = new Set();

  for (const event of events) {
    if (!event.title || !event.startTime || event.status === 'CANCELLED') continue;
    if (CANCELLED_TITLE.test(event.title)) continue;

    const end = event.endTime || (event.allDay ? new Date(event.startTime.getTime() + ONE_DAY_MS) : null);
    // Skip anything already over
    if ((end || event.startTime) < now) continue;

    const tags = inferTags(event.title, event.description || '');
    const vibe = inferVibe(tags);
    const sourceId = event.uid || event.url || `${source}-${slugify(event.title)}-${event.startTime.toISOString()}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    rows.push({
      title: truncate(event.title, 500),
      slug: truncate(slugify(event.title) || 'event', 500),
      description: event.description || null,
      start_time: event.startTime.toISOString(),
      end_time: end ? end.toISOString() : null,
      venue_address: event.location || null,
      source_url: truncate(event.url, 500),
      source,
      source_id: truncate(sourceId, 255),
      tags,
      categories: tags.filter(t => t !== 'general'),
      primary_category: tags[0] || null,
      vibe_quiet: vibe.quiet,
      vibe_inside: vibe.inside,
      vibe_active: vibe.active,
      kid_friendly: tags.includes('kid-friendly'),
      is_free: tags.includes('free'),
    });
  }

  return rows;
}

/**
 * Drop rows that another source already lists (same title within an hour)
 */
export async function removeCrossSourceDuplicates(client, cityId, source, rows) {
  if (rows.length === 0) return { rows, duplicates: 0 };

  const starts = rows.map(r => new Date(r.start_time).getTime());
  const from = new Date(Math.min(...starts) - DUPLICATE_WINDOW_MS);
  const to = new Date(Math.max(...starts) + DUPLICATE_WINDOW_MS);

  const { rows: others } = await client.query(`
    SELECT title, start_time
    FROM events
    WHERE city_id = $1 AND source <> $2 AND is_active = TRUE
      AND start_time BETWEEN $3 AND $4
  `, [cityId, source, from.toISOString(), to.toISOString()]);

  const existing = new Map();
  for (const other of others) {
    const key = dedupKey(other.title);
    if (!existing.has(key)) existing.set(key, []);
    existing.get(key).push(new Date(other.start_time).getTime());
  }

  const kept = rows.filter(row => {
    const times = existing.get(dedupKey(row.title));
    if (!times) return true;
    const start = new Date(row.start_time).getTime();
    return !times.some(t => Math.abs(t - start) <= DUPLICATE_WINDOW_MS);
  });

  return { rows: kept, duplicates: rows.length - kept.length };
}

const UPSERT_SQL = `
  INSERT INTO events (
    city_id, title, slug, description, start_time, end_time, venue_address,
    source_url, source, source_id, tags, categories, primary_category,
    vibe_quiet, vibe_inside, vibe_active, kid_friendly, is_free,
    is_active, scraped_at
  )
  SELECT
    $1, r.title, r.slug, r.description, r.start_time, r.end_time, r.venue_address,
    r.source_url, r.source, r.source_id, r.tags, r.categories, r.primary_category,
    r.vibe_quiet, r.vibe_inside, r.vibe_active, r.kid_friendly, r.is_free,
    TRUE, NOW()
  FROM json_to_recordset($2::json) AS r(
    title text, slug text, description text, start_time timestamptz, end_time timestamptz,
    venue_address text, source_url text, source text, source_id text, tags text[],
    categories text[], primary_category text, vibe_quiet numeric, vibe_inside numeric,
    vibe_active numeric, kid_friendly boolean, is_free boolean
  )
  ON CONFLICT (source, source_id) DO UPDATE SET
    title = EXCLUDED.title,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    venue_address = EXCLUDED.venue_address,
    source_url = EXCLUDED.source_url,
    tags = EXCLUDED.tags,
    categories = EXCLUDED.categories,
    primary_category = EXCLUDED.primary_category,
    vibe_quiet = EXCLUDED.vibe_quiet,
    vibe_inside = EXCLUDED.vibe_inside,
    vibe_active = EXCLUDED.vibe_active,
    kid_friendly = EXCLUDED.kid_friendly,
    is_free = EXCLUDED.is_free,
    is_active = TRUE,
    scraped_at = NOW(),
    updated_at = NOW(),
    embedding = CASE
      WHEN events.title IS DISTINCT FROM EXCLUDED.title
        OR events.description IS DISTINCT FROM EXCLUDED.description
      THEN NULL
      ELSE events.embedding
    END
  RETURNING (xmax = 0) AS inserted
`;

const CHUNK_SIZE = 200;

/**
 * Insert or update rows in bulk
 */
export async function upsertEventRows(client, cityId, rows) {
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const result = await client.query(UPSERT_SQL, [cityId, JSON.stringify(chunk)]);
    for (const row of result.rows) {
      if (row.inserted) inserted++;
      else updated++;
    }
  }

  return { inserted, updated };
}

export async function fetchFeed(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/calendar, text/plain, */*' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const text = await response.text();
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error(`${url} did not return an ICS calendar`);
  }
  return text;
}

/**
 * Fetch, parse and save every configured feed. One failing feed never
 * stops the others.
 */
export async function ingestFeeds(pool, { feeds = getFeeds(), fetchImpl = fetch, now = new Date(), log = console.log } = {}) {
  const cityResult = await pool.query("SELECT id FROM cities WHERE slug = 'madison'");
  const cityId = cityResult.rows[0]?.id;
  if (!cityId) throw new Error("City 'madison' not found");

  const results = [];

  for (const feed of feeds) {
    const result = { source: feed.source, name: feed.name || feed.source };
    try {
      const ics = await fetchFeed(feed.url, fetchImpl);
      const parsed = parseICS(ics);
      const rows = toEventRows(parsed, feed.source, now);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const deduped = await removeCrossSourceDuplicates(client, cityId, feed.source, rows);
        const saved = await upsertEventRows(client, cityId, deduped.rows);
        await client.query('COMMIT');
        Object.assign(result, {
          ok: true,
          parsed: parsed.length,
          upcoming: rows.length,
          duplicates: deduped.duplicates,
          ...saved,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      Object.assign(result, { ok: false, error: err.message });
    }

    log(result.ok
      ? `✅ ${result.name}: ${result.inserted} new, ${result.updated} updated, ${result.duplicates} duplicates skipped`
      : `❌ ${result.name}: ${result.error}`);
    results.push(result);
  }

  return results;
}
