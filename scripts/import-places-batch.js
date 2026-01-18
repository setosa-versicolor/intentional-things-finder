/**
 * Import Places Batch Script
 * Reads markdown content files and imports places to database
 *
 * Usage: node scripts/import-places-batch.js
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env.local before importing other modules
dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
import { generateActivityEmbedding } from '../api/_lib/embeddings.js';

const { Pool } = pg;

// Parse markdown content file
function parseMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const places = [];

  // Split by ## headers (place entries)
  const entries = content.split(/^## \d+\. /m).slice(1); // Skip first empty entry

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const name = lines[0].trim();

    let story = '';
    let nudge = '';
    let tags = [];
    let vibe = { quiet: 0.5, inside: 0.5, active: 0.5 };
    let location = '';
    let price = 2;

    // Parse each line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('**Story**:')) {
        story = line.replace('**Story**:', '').trim();
      } else if (line.startsWith('**Nudge**:')) {
        nudge = line.replace('**Nudge**:', '').trim();
      } else if (line.startsWith('**Tags**:')) {
        const tagStr = line.replace('**Tags**:', '').trim();
        tags = tagStr.split(',').map(t => t.trim());
      } else if (line.startsWith('**Vibe**:')) {
        const vibeStr = line.replace('**Vibe**:', '').trim();
        const vibeMatch = vibeStr.match(/([\d.]+)[^,]*, ([\d.]+)[^,]*, ([\d.]+)/);
        if (vibeMatch) {
          vibe.quiet = parseFloat(vibeMatch[1]);
          vibe.inside = parseFloat(vibeMatch[2]);
          vibe.active = parseFloat(vibeMatch[3]);
        }
      } else if (line.startsWith('**Location**:')) {
        location = line.replace('**Location**:', '').trim();
      } else if (line.startsWith('**Price**:')) {
        const priceStr = line.replace('**Price**:', '').trim();
        price = parseInt(priceStr) || 2;
      }
    }

    places.push({
      name,
      story,
      nudge,
      tags,
      vibe,
      location,
      price,
    });
  }

  return places;
}

// Generate slug from name
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Import places to database
async function importPlaces() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    // Get Madison city_id
    const cityResult = await pool.query(
      "SELECT id FROM cities WHERE slug = 'madison'"
    );
    const cityId = cityResult.rows[0].id;

    // Find all content draft files
    const draftsDir = path.join(process.cwd(), 'content-drafts');
    const files = fs.readdirSync(draftsDir).filter(f => f.endsWith('.md'));

    console.log(`📁 Found ${files.length} content files\n`);

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Map file names to place types
    const typeMap = {
      'coffee': 'café',
      'upscale': 'restaurant',
      'casual': 'restaurant',
      'cocktail': 'bar',
      'breweries': 'brewery',
      'brunch': 'restaurant',
      'parks': 'park',
      'nature': 'trail'
    };

    for (const file of files) {
      console.log(`📄 Processing ${file}...`);
      const filePath = path.join(draftsDir, file);
      const places = parseMarkdownFile(filePath);

      // Infer type from filename
      let placeType = 'other';
      for (const [key, type] of Object.entries(typeMap)) {
        if (file.includes(key)) {
          placeType = type;
          break;
        }
      }

      console.log(`   Found ${places.length} places in file (type: ${placeType})`);

      for (const place of places) {
        try {
          const slug = slugify(place.name);

          // Check if place already exists
          const existing = await pool.query(
            'SELECT id FROM places WHERE slug = $1',
            [slug]
          );

          if (existing.rows.length > 0) {
            console.log(`   ⏭️  Skipped: ${place.name} (already exists)`);
            totalSkipped++;
            continue;
          }

          // Generate embedding
          console.log(`   🔄 Generating embedding for: ${place.name}`);
          const activityData = {
            name: place.name,
            story: place.story,
            tags: place.tags,
            vibe_quiet: place.vibe.quiet,
            vibe_inside: place.vibe.inside,
            vibe_active: place.vibe.active,
          };

          const embedding = await generateActivityEmbedding(activityData);
          const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

          // Insert place
          await pool.query(`
            INSERT INTO places (
              city_id, name, slug, type, story, nudge,
              vibe_quiet, vibe_inside, vibe_active,
              tags, neighborhood, price_level,
              embedding, is_active
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector, $14
            )
          `, [
            cityId,
            place.name,
            slug,
            placeType,
            place.story,
            place.nudge,
            place.vibe.quiet,
            place.vibe.inside,
            place.vibe.active,
            place.tags,
            place.location,
            place.price,
            embeddingStr,
            true
          ]);

          console.log(`   ✅ Inserted: ${place.name}`);
          totalInserted++;

          // Rate limiting: 100ms between embeddings
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (err) {
          console.error(`   ❌ Error inserting ${place.name}:`, err.message);
          totalErrors++;
        }
      }

      console.log('');
    }

    console.log('\n📊 Import Summary:');
    console.log(`   ✅ Inserted: ${totalInserted}`);
    console.log(`   ⏭️  Skipped: ${totalSkipped}`);
    console.log(`   ❌ Errors: ${totalErrors}`);
    console.log('\n✨ Import complete!');

  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === new URL(process.argv[1], 'file:').href ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  importPlaces();
}

export { importPlaces, parseMarkdownFile };
