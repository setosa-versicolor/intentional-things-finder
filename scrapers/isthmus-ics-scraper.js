/**
 * Isthmus ICS Feed Parser
 *
 * Much more reliable than web scraping - parses the official ICS calendar feed
 * from https://isthmus.com/search/event/calendar-of-events/calendar.ics
 */

import https from 'https';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ICS_URL = 'https://isthmus.com/search/event/calendar-of-events/calendar.ics';

// Category mapping from event descriptions/summaries
const inferCategories = (summary, description) => {
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
};

// Infer vibe from categories
const inferVibe = (tags) => {
  let quietScore = 0.5;
  let insideScore = 0.5;

  if (tags.some(t => ['music', 'nightlife', 'social', 'sports'].includes(t))) {
    quietScore = 0.2; // loud/social
  } else if (tags.some(t => ['art', 'lectures', 'film'].includes(t))) {
    quietScore = 0.7; // quiet
  }

  if (tags.some(t => ['outdoors', 'nature'].includes(t))) {
    insideScore = 0.2; // outside
  } else if (tags.some(t => ['theater', 'film', 'lectures', 'art'].includes(t))) {
    insideScore = 0.9; // inside
  }

  return { quiet: quietScore, inside: insideScore };
};

// Parse ICS format
function parseICS(icsContent) {
  const events = [];
  const lines = icsContent.split(/\r?\n/);
  let currentEvent = null;
  let currentField = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Handle line continuation (lines starting with space or tab)
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

        // Parse different field types
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

// Parse ICS date format (YYYYMMDDTHHMMSS or YYYYMMDD)
function parseICSDate(dateStr) {
  // Remove timezone info for simplicity
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

// Generate slug from title
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
}

// Fetch ICS feed
async function fetchICS() {
  return new Promise((resolve, reject) => {
    https.get(ICS_URL, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function saveToDatabase(events) {
  console.log('💾 Saving events to database...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get Madison city_id
    const cityResult = await client.query(
      "SELECT id FROM cities WHERE slug = 'madison'"
    );
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

        // Check if event already exists (by URL or UID)
        const sourceId = event.uid || event.url || `isthmus-${slug}-${event.startTime.toISOString()}`;

        const existing = await client.query(
          'SELECT id FROM events WHERE source = $1 AND source_id = $2',
          ['isthmus', sourceId]
        );

        if (existing.rows.length === 0) {
          // Insert new event
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
            null, event.location, // venue name/address combined in location
            event.url,
            'isthmus', sourceId, true
          ]);

          inserted++;
        } else {
          // Update existing event
          await client.query(`
            UPDATE events SET
              title = $1, description = $2, start_time = $3, end_time = $4,
              vibe_quiet = $5, vibe_inside = $6, tags = $7,
              venue_address = $8, source_url = $9,
              updated_at = NOW()
            WHERE source = $10 AND source_id = $11
          `, [
            event.title, event.description, event.startTime, event.endTime,
            vibe.quiet, vibe.inside, tags,
            event.location, event.url,
            'isthmus', sourceId
          ]);

          updated++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing event: ${event.title}`, err.message);
        skipped++;
      }
    }

    await client.query('COMMIT');

    console.log(`✅ Database save complete:`);
    console.log(`   - Inserted: ${inserted}`);
    console.log(`   - Updated: ${updated}`);
    console.log(`   - Skipped: ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database error:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('🚀 Fetching Isthmus ICS feed...');
    const icsContent = await fetchICS();

    console.log('📅 Parsing ICS events...');
    const events = parseICS(icsContent);
    console.log(`✅ Found ${events.length} events in feed`);

    await saveToDatabase(events);
    console.log('🎉 Isthmus ICS scraper completed successfully');
  } catch (err) {
    console.error('❌ Scraper failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === new URL(process.argv[1], 'file:').href ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}

export { fetchICS, parseICS, saveToDatabase };
