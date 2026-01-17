/**
 * Import Events Script
 * Re-imports events from Isthmus ICS feed into Vercel Postgres
 *
 * Run after migration:
 * node scripts/import-events.js
 */

import https from 'https';
import pg from 'pg';
import dotenv from 'dotenv';

// Load .env.local first (Vercel env vars), then fall back to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pg;

// Reuse functions from the ICS scraper
function parseICS(icsContent) {
  const events = [];
  const lines = icsContent.split(/\r?\n/);
  let currentEvent = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    while (i + 1 < lines.length && lines[i + 1].match(/^[ \t]/)) {
      i++;
      line += lines[i].trim();
    }

    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      events.push(currentEvent);
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const fieldName = line.substring(0, colonIndex);
        const fieldValue = line.substring(colonIndex + 1);

        if (fieldName === 'SUMMARY') {
          currentEvent.title = fieldValue;
        } else if (fieldName === 'DESCRIPTION') {
          currentEvent.description = fieldValue.replace(/\\n/g, '\n').replace(/\\,/g, ',');
        } else if (fieldName.startsWith('DTSTART')) {
          currentEvent.startTime = parseICSDate(fieldValue);
        } else if (fieldName.startsWith('DTEND')) {
          currentEvent.endTime = parseICSDate(fieldValue);
        } else if (fieldName === 'LOCATION') {
          currentEvent.location = fieldValue.replace(/\\,/g, ',');
        } else if (fieldName === 'URL') {
          currentEvent.url = fieldValue;
        } else if (fieldName === 'UID') {
          currentEvent.uid = fieldValue;
        }
      }
    }
  }

  return events;
}

function parseICSDate(dateStr) {
  dateStr = dateStr.replace(/[TZ]/g, '').split(';')[0];
  if (dateStr.length >= 8) {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    const hour = dateStr.substring(8, 10) || '00';
    const minute = dateStr.substring(10, 12) || '00';
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
  }
  return null;
}

function inferCategories(summary, description) {
  const text = `${summary} ${description}`.toLowerCase();
  const tags = [];

  if (text.match(/music|concert|band|jazz|rock|dj/)) tags.push('music', 'live-music');
  if (text.match(/comedy|comedian|standup|improv/)) tags.push('comedy', 'entertainment');
  if (text.match(/art|exhibit|gallery|painting|sculpture/)) tags.push('art', 'culture');
  if (text.match(/theater|theatre|play|performance|drama/)) tags.push('theater', 'performing-arts');
  if (text.match(/film|movie|cinema|screening/)) tags.push('film', 'movies');
  if (text.match(/food|drink|beer|wine|restaurant|dining/)) tags.push('food', 'drink');
  if (text.match(/kids|family|children/)) tags.push('family', 'kids');
  if (text.match(/outdoor|nature|park|hiking|garden/)) tags.push('outdoors', 'nature');
  if (text.match(/dance|dancing|ballet/)) tags.push('music', 'social', 'nightlife');
  if (text.match(/lecture|talk|seminar|discussion/)) tags.push('education', 'lectures');
  if (text.match(/sports|fitness|yoga|gym|exercise/)) tags.push('sports', 'fitness');

  return tags.length > 0 ? tags : ['general'];
}

function inferVibe(tags) {
  let quietScore = 0.5;
  let insideScore = 0.5;

  if (tags.some(t => ['music', 'nightlife', 'social', 'sports'].includes(t))) {
    quietScore = 0.2;
  } else if (tags.some(t => ['art', 'lectures', 'film'].includes(t))) {
    quietScore = 0.7;
  }

  if (tags.some(t => ['outdoors', 'nature'].includes(t))) {
    insideScore = 0.2;
  } else if (tags.some(t => ['theater', 'film', 'lectures', 'art'].includes(t))) {
    insideScore = 0.9;
  }

  return { quiet: quietScore, inside: insideScore };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
}

async function fetchICS() {
  return new Promise((resolve, reject) => {
    https.get('https://isthmus.com/search/event/calendar-of-events/calendar.ics', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function importEvents() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🚀 Fetching Isthmus ICS feed...');
  const icsContent = await fetchICS();

  console.log('📅 Parsing ICS events...');
  const events = parseICS(icsContent);
  console.log(`✅ Found ${events.length} events in feed\n`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const cityResult = await client.query("SELECT id FROM cities WHERE slug = 'madison'");
    const cityId = cityResult.rows[0].id;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        if (!event.title || !event.startTime) {
          skipped++;
          continue;
        }

        const tags = inferCategories(event.title, event.description || '');
        const vibe = inferVibe(tags);
        const slug = slugify(event.title);
        const sourceId = event.uid || event.url || `isthmus-${slug}-${event.startTime.toISOString()}`;

        const existing = await client.query(
          'SELECT id FROM events WHERE source = $1 AND source_id = $2',
          ['isthmus', sourceId]
        );

        if (existing.rows.length === 0) {
          await client.query(`
            INSERT INTO events (
              city_id, title, description, slug, start_time, end_time,
              vibe_quiet, vibe_inside, tags, venue_name, venue_address,
              source_url, source, source_id, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `, [
            cityId, event.title, event.description, slug,
            event.startTime, event.endTime,
            vibe.quiet, vibe.inside, tags,
            null, event.location,
            event.url,
            'isthmus', sourceId, true
          ]);
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        console.error(`  ❌ Error: ${event.title}`, err.message);
        skipped++;
      }
    }

    await client.query('COMMIT');

    console.log('✅ Import complete:');
    console.log(`   - Inserted: ${inserted}`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Skipped: ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Import failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

importEvents();
