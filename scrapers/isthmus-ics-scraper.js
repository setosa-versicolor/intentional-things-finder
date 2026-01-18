/**
 * Isthmus ICS Feed Parser
 *
 * Much more reliable than web scraping - parses the official ICS calendar feed
 * from https://isthmus.com/search/event/calendar-of-events/calendar.ics
 */

import https from 'https';
import pg from 'pg';
import dotenv from 'dotenv';
import { generateActivityEmbedding, hasEmbedding } from '../api/_lib/embeddings.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
});

const ICS_URL = 'https://isthmus.com/search/event/calendar-of-events/calendar.ics';

// Tag mapping from event descriptions/summaries
const inferTags = (summary, description) => {
  const text = `${summary} ${description}`.toLowerCase();
  const tags = [];

  // New tag system
  if (text.match(/food|dining|restaurant|meal|cuisine|chef/)) tags.push('food-focused');
  if (text.match(/kids|family|children|youth/)) tags.push('kid-friendly');
  if (text.match(/date|romantic|couples|wine|intimate/)) tags.push('date-night');
  if (text.match(/art|creative|craft|workshop|painting|sculpture/)) tags.push('creative');
  if (text.match(/lecture|learn|workshop|education|seminar|class/)) tags.push('educational');
  if (text.match(/nature|outdoor|park|garden|hiking|trail/)) tags.push('nature');
  if (text.match(/social|community|gathering|meet|group/)) tags.push('friend-hangout');
  if (text.match(/unusual|unique|quirky|weird|different/)) tags.push('unusual-options');
  if (text.match(/free admission|no cost|donation/i)) tags.push('free');
  if (text.match(/music|concert|band|jazz|rock|dj/)) tags.push('friend-hangout');
  if (text.match(/comedy|comedian|standup|improv/)) tags.push('friend-hangout', 'date-night');

  // Legacy tags (for internal categorization)
  const legacyTags = [];
  if (text.match(/music|concert|band|jazz|rock|dj/)) legacyTags.push('music', 'live-music');
  if (text.match(/comedy|comedian|standup|improv/)) legacyTags.push('comedy', 'entertainment');
  if (text.match(/art|exhibit|gallery|painting|sculpture/)) legacyTags.push('art', 'culture');
  if (text.match(/theater|theatre|play|performance|drama/)) legacyTags.push('theater', 'performing-arts');
  if (text.match(/film|movie|cinema|screening/)) legacyTags.push('film', 'movies');
  if (text.match(/food|drink|beer|wine|restaurant|dining/)) legacyTags.push('food', 'drink');
  if (text.match(/kids|family|children/)) legacyTags.push('family', 'kids');
  if (text.match(/outdoor|nature|park|hiking|garden/)) legacyTags.push('outdoors', 'nature');
  if (text.match(/dance|dancing|ballet/)) legacyTags.push('music', 'social', 'nightlife');
  if (text.match(/lecture|talk|seminar|discussion/)) legacyTags.push('education', 'lectures');
  if (text.match(/sports|fitness|yoga|gym|exercise/)) legacyTags.push('sports', 'fitness');

  return {
    userTags: tags.length > 0 ? tags : [],
    legacyTags: legacyTags.length > 0 ? legacyTags : ['general']
  };
};

// Infer vibe from legacy categories
const inferVibe = (legacyTags) => {
  let quietScore = 0.5;
  let insideScore = 0.5;
  let activeScore = 0.5;

  if (legacyTags.some(t => ['music', 'nightlife', 'social', 'sports'].includes(t))) {
    quietScore = 0.2; // loud/social
    activeScore = 0.7; // active
  } else if (legacyTags.some(t => ['art', 'lectures', 'film'].includes(t))) {
    quietScore = 0.7; // quiet
    activeScore = 0.3; // relaxing
  }

  if (legacyTags.some(t => ['outdoors', 'nature', 'sports'].includes(t))) {
    insideScore = 0.2; // outside
    activeScore = 0.6; // moderately active
  } else if (legacyTags.some(t => ['theater', 'film', 'lectures', 'art'].includes(t))) {
    insideScore = 0.9; // inside
    activeScore = 0.3; // relaxing
  }

  // Yoga and meditation are relaxing
  if (legacyTags.some(t => t.match(/yoga|meditation|spa/))) {
    activeScore = 0.1;
  }

  return { quiet: quietScore, inside: insideScore, active: activeScore };
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

        const { userTags, legacyTags } = inferTags(event.title, event.description || '');
        const vibe = inferVibe(legacyTags);
        const slug = slugify(event.title);

        // Combine user-facing and legacy tags
        const allTags = [...new Set([...userTags, ...legacyTags])];

        // Check if event already exists (by URL or UID)
        const sourceId = event.uid || event.url || `isthmus-${slug}-${event.startTime.toISOString()}`;

        const existing = await client.query(
          'SELECT id, embedding, title, description FROM events WHERE source = $1 AND source_id = $2',
          ['isthmus', sourceId]
        );

        // Determine if we need to generate embedding
        let embedding = null;
        let embeddingStr = null; // Formatted string for SQL
        const needsEmbedding = existing.rows.length === 0 || // New event
                               !existing.rows[0].embedding || // No existing embedding
                               existing.rows[0].title !== event.title || // Title changed
                               existing.rows[0].description !== event.description; // Description changed

        if (needsEmbedding) {
          const activityData = {
            title: event.title,
            description: event.description,
            tags: allTags,
            vibe_quiet: vibe.quiet,
            vibe_inside: vibe.inside,
            vibe_active: vibe.active
          };
          embedding = await generateActivityEmbedding(activityData);
          // Format as vector string for SQL: [0.1,0.2,0.3,...]
          embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
        } else {
          // Reuse existing embedding (already in correct format in DB)
          embeddingStr = null; // Don't update if reusing
        }

        if (existing.rows.length === 0) {
          // Insert new event
          await client.query(`
            INSERT INTO events (
              city_id, title, description, slug, start_time, end_time,
              vibe_quiet, vibe_inside, vibe_active, tags, venue_name, venue_address,
              source_url, source, source_id, embedding, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::vector, $17)
          `, [
            cityId, event.title, event.description, slug,
            event.startTime, event.endTime,
            vibe.quiet, vibe.inside, vibe.active, allTags,
            null, event.location, // venue name/address combined in location
            event.url,
            'isthmus', sourceId,
            embeddingStr,
            true
          ]);

          inserted++;
        } else {
          // Update existing event - only update embedding if needsEmbedding is true
          if (needsEmbedding && embeddingStr) {
            await client.query(`
              UPDATE events SET
                title = $1, description = $2, start_time = $3, end_time = $4,
                vibe_quiet = $5, vibe_inside = $6, vibe_active = $7, tags = $8,
                venue_address = $9, source_url = $10, embedding = $11::vector,
                updated_at = NOW()
              WHERE source = $12 AND source_id = $13
            `, [
              event.title, event.description, event.startTime, event.endTime,
              vibe.quiet, vibe.inside, vibe.active, allTags,
              event.location, event.url,
              embeddingStr,
              'isthmus', sourceId
            ]);
          } else {
            // Don't update embedding if reusing existing one
            await client.query(`
              UPDATE events SET
                title = $1, description = $2, start_time = $3, end_time = $4,
                vibe_quiet = $5, vibe_inside = $6, vibe_active = $7, tags = $8,
                venue_address = $9, source_url = $10,
                updated_at = NOW()
              WHERE source = $11 AND source_id = $12
            `, [
              event.title, event.description, event.startTime, event.endTime,
              vibe.quiet, vibe.inside, vibe.active, allTags,
              event.location, event.url,
              'isthmus', sourceId
            ]);
          }

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
