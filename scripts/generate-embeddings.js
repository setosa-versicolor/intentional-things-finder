/**
 * Generate Embeddings for Existing Places and Events
 * One-time script to add embeddings to activities that don't have them
 *
 * Usage: node scripts/generate-embeddings.js [--places] [--events] [--force]
 */

import dotenv from 'dotenv';

// IMPORTANT: Load .env.local BEFORE importing other modules
// so OPENAI_API_KEY is available when embeddings.js loads
dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
import { generateActivityEmbedding } from '../api/_lib/embeddings.js';

const { Pool } = pg;

async function generateEmbeddings() {
  const args = process.argv.slice(2);
  const doPlaces = args.includes('--places') || args.length === 0;
  const doEvents = args.includes('--events') || args.length === 0;
  const force = args.includes('--force');

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🚀 Generating embeddings for activities...\n');
  console.log(`Options:`);
  console.log(`  - Places: ${doPlaces ? '✅' : '❌'}`);
  console.log(`  - Events: ${doEvents ? '✅' : '❌'}`);
  console.log(`  - Force regenerate: ${force ? '✅' : '❌'}\n`);

  try {
    // Generate embeddings for places
    if (doPlaces) {
      console.log('📍 Processing places...');

      const placesQuery = force
        ? 'SELECT * FROM places WHERE is_active = TRUE'
        : 'SELECT * FROM places WHERE is_active = TRUE AND embedding IS NULL';

      const places = await pool.query(placesQuery);
      console.log(`  Found ${places.rows.length} places to process\n`);

      for (let i = 0; i < places.rows.length; i++) {
        const place = places.rows[i];
        console.log(`  [${i + 1}/${places.rows.length}] ${place.name}...`);

        const activityData = {
          name: place.name,
          story: place.story,
          tags: place.tags,
          vibe_quiet: place.vibe_quiet,
          vibe_inside: place.vibe_inside,
          vibe_active: place.vibe_active,
        };

        const embedding = await generateActivityEmbedding(activityData);

        if (embedding) {
          await pool.query(
            'UPDATE places SET embedding = $1 WHERE id = $2',
            [JSON.stringify(embedding), place.id]
          );
          console.log(`    ✅ Embedding generated and saved`);
        } else {
          console.log(`    ⚠️  Skipped (no OpenAI API key or error)`);
        }

        // Rate limiting: 100ms between requests
        if (i < places.rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`\n✅ Places complete!\n`);
    }

    // Generate embeddings for events
    if (doEvents) {
      console.log('📅 Processing events...');

      const eventsQuery = force
        ? 'SELECT * FROM events WHERE is_active = TRUE AND start_time > NOW()'
        : 'SELECT * FROM events WHERE is_active = TRUE AND start_time > NOW() AND embedding IS NULL';

      const events = await pool.query(eventsQuery);
      console.log(`  Found ${events.rows.length} events to process\n`);

      for (let i = 0; i < events.rows.length; i++) {
        const event = events.rows[i];
        console.log(`  [${i + 1}/${events.rows.length}] ${event.title}...`);

        const activityData = {
          title: event.title,
          description: event.description,
          tags: event.tags,
          vibe_quiet: event.vibe_quiet,
          vibe_inside: event.vibe_inside,
          vibe_active: event.vibe_active,
        };

        const embedding = await generateActivityEmbedding(activityData);

        if (embedding) {
          await pool.query(
            'UPDATE events SET embedding = $1 WHERE id = $2',
            [JSON.stringify(embedding), event.id]
          );
          console.log(`    ✅ Embedding generated and saved`);
        } else {
          console.log(`    ⚠️  Skipped (no OpenAI API key or error)`);
        }

        // Rate limiting: 100ms between requests
        if (i < events.rows.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`\n✅ Events complete!\n`);
    }

    // Summary
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM places WHERE embedding IS NOT NULL) as places_with_embeddings,
        (SELECT COUNT(*) FROM places WHERE is_active = TRUE) as total_places,
        (SELECT COUNT(*) FROM events WHERE embedding IS NOT NULL AND start_time > NOW()) as events_with_embeddings,
        (SELECT COUNT(*) FROM events WHERE is_active = TRUE AND start_time > NOW()) as total_events
    `);

    const { places_with_embeddings, total_places, events_with_embeddings, total_events } = stats.rows[0];

    console.log('📊 Summary:');
    console.log(`  Places: ${places_with_embeddings}/${total_places} have embeddings`);
    console.log(`  Events: ${events_with_embeddings}/${total_events} have embeddings`);
    console.log('\n✨ Embedding generation complete!');

  } catch (err) {
    console.error('❌ Error generating embeddings:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

generateEmbeddings();
