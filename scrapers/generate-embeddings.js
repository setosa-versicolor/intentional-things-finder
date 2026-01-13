/**
 * Generate Embeddings for Places and Events
 *
 * Uses OpenAI text-embedding-3-small to generate vector embeddings
 * for semantic search capabilities
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Rate limiting
const REQUESTS_PER_MINUTE = 3000; // OpenAI tier limits
const DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateEmbedding(text) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set in environment');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000), // Limit to ~8k chars to stay under token limit
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;

  } catch (err) {
    console.error('  ❌ Embedding generation failed:', err.message);
    return null;
  }
}

async function generatePlaceEmbeddings() {
  console.log('🏢 Generating embeddings for places...');

  const client = await pool.connect();

  try {
    // Get all places without embeddings
    const result = await client.query(`
      SELECT id, name, story, nudge, tags
      FROM places
      WHERE embedding IS NULL AND is_active = TRUE
    `);

    const places = result.rows;
    console.log(`  Found ${places.length} places without embeddings`);

    let generated = 0;
    let failed = 0;

    for (const place of places) {
      try {
        // Combine text for embedding
        const text = [
          place.name,
          place.story || '',
          place.nudge || '',
          (place.tags || []).join(', '),
        ].filter(Boolean).join('\n\n');

        console.log(`  Generating embedding for: ${place.name}`);

        const embedding = await generateEmbedding(text);

        if (embedding) {
          // Update place with embedding
          await client.query(
            'UPDATE places SET embedding = $1 WHERE id = $2',
            [`[${embedding.join(',')}]`, place.id]
          );
          generated++;
        } else {
          failed++;
        }

        // Rate limiting
        await sleep(DELAY_MS);

      } catch (err) {
        console.error(`  ❌ Error processing place ${place.name}:`, err.message);
        failed++;
      }
    }

    console.log(`✅ Place embeddings complete:`);
    console.log(`   - Generated: ${generated}`);
    console.log(`   - Failed: ${failed}`);

  } finally {
    client.release();
  }
}

async function generateEventEmbeddings() {
  console.log('🎉 Generating embeddings for events...');

  const client = await pool.connect();

  try {
    // Get all events without embeddings (future events only)
    const result = await client.query(`
      SELECT id, title, description, categories, tags
      FROM events
      WHERE embedding IS NULL
        AND is_active = TRUE
        AND start_time > NOW()
    `);

    const events = result.rows;
    console.log(`  Found ${events.length} events without embeddings`);

    let generated = 0;
    let failed = 0;

    for (const event of events) {
      try {
        // Combine text for embedding
        const text = [
          event.title,
          event.description || '',
          (event.categories || []).join(', '),
          (event.tags || []).join(', '),
        ].filter(Boolean).join('\n\n');

        console.log(`  Generating embedding for: ${event.title}`);

        const embedding = await generateEmbedding(text);

        if (embedding) {
          // Update event with embedding
          await client.query(
            'UPDATE events SET embedding = $1 WHERE id = $2',
            [`[${embedding.join(',')}]`, event.id]
          );
          generated++;
        } else {
          failed++;
        }

        // Rate limiting
        await sleep(DELAY_MS);

      } catch (err) {
        console.error(`  ❌ Error processing event ${event.title}:`, err.message);
        failed++;
      }
    }

    console.log(`✅ Event embeddings complete:`);
    console.log(`   - Generated: ${generated}`);
    console.log(`   - Failed: ${failed}`);

  } finally {
    client.release();
  }
}

async function createVectorIndexes() {
  console.log('📊 Creating vector indexes...');

  const client = await pool.connect();

  try {
    // Check if we have enough data for IVFFlat index
    const placeCount = await client.query('SELECT COUNT(*) FROM places WHERE embedding IS NOT NULL');
    const eventCount = await client.query('SELECT COUNT(*) FROM events WHERE embedding IS NOT NULL');

    const placesWithEmbeddings = parseInt(placeCount.rows[0].count);
    const eventsWithEmbeddings = parseInt(eventCount.rows[0].count);

    console.log(`  Places with embeddings: ${placesWithEmbeddings}`);
    console.log(`  Events with embeddings: ${eventsWithEmbeddings}`);

    // IVFFlat requires at least 100 rows for training
    if (placesWithEmbeddings >= 100) {
      console.log('  Creating IVFFlat index for places...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_places_embedding
        ON places USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = ${Math.ceil(placesWithEmbeddings / 10)})
      `);
      console.log('  ✅ Places index created');
    } else {
      console.log('  ⚠️  Not enough places for IVFFlat (need 100+), using HNSW...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_places_embedding
        ON places USING hnsw (embedding vector_cosine_ops)
      `);
    }

    if (eventsWithEmbeddings >= 100) {
      console.log('  Creating IVFFlat index for events...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_events_embedding
        ON events USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = ${Math.ceil(eventsWithEmbeddings / 10)})
      `);
      console.log('  ✅ Events index created');
    } else if (eventsWithEmbeddings > 0) {
      console.log('  ⚠️  Not enough events for IVFFlat (need 100+), using HNSW...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_events_embedding
        ON events USING hnsw (embedding vector_cosine_ops)
      `);
    }

    console.log('✅ Vector indexes ready');

  } catch (err) {
    console.error('❌ Index creation error:', err.message);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await generatePlaceEmbeddings();
    await generateEventEmbeddings();
    await createVectorIndexes();
    console.log('🎉 Embedding generation completed successfully');
  } catch (err) {
    console.error('❌ Embedding generation failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generatePlaceEmbeddings, generateEventEmbeddings, createVectorIndexes };
