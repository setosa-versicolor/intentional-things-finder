/**
 * Import places from CSV to database
 *
 * This script reads the discover-madison-places.csv file and imports
 * any places that don't already exist in the database.
 */

import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
import { generateActivityEmbedding } from '../api/_lib/embeddings.js';

const { Pool } = pg;

// Robust CSV parser that handles quoted fields and escaped quotes
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = [];
  const records = [];

  // Parse header
  let values = [];
  let current = '';
  let inQuotes = false;

  for (let j = 0; j < lines[0].length; j++) {
    const char = lines[0][j];
    const nextChar = lines[0][j + 1];

    if (char === '"' && nextChar === '"' && inQuotes) {
      // Escaped quote
      current += '"';
      j++; // Skip next quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim());

  // Parse rows
  for (let i = 1; i < lines.length; i++) {
    values = [];
    current = '';
    inQuotes = false;

    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      const nextChar = lines[i][j + 1];

      if (char === '"' && nextChar === '"' && inQuotes) {
        // Escaped quote
        current += '"';
        j++; // Skip next quote
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || '';
    });
    records.push(record);
  }

  return records;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function importFromCSV() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    console.log('📊 Reading CSV file...\n');

    const csvContent = fs.readFileSync('discover-madison-places.csv', 'utf-8');
    const records = parseCSV(csvContent);

    console.log(`Found ${records.length} places in CSV\n`);

    // Get existing place IDs from database
    const existingResult = await pool.query('SELECT id FROM places');
    const existingIds = new Set(existingResult.rows.map(r => r.id));

    console.log(`Found ${existingIds.size} places already in database\n`);

    // Filter to only new places
    const newPlaces = records.filter(r => {
      const id = parseInt(r.ID);
      return !existingIds.has(id);
    });

    console.log(`Found ${newPlaces.length} new places to import\n`);

    if (newPlaces.length === 0) {
      console.log('✅ All places from CSV are already in the database!');
      return;
    }

    // Get Madison city_id
    const cityResult = await pool.query("SELECT id FROM cities WHERE slug = 'madison'");
    const cityId = cityResult.rows[0].id;

    let imported = 0;
    let failed = 0;

    for (const place of newPlaces) {
      console.log(`\n📍 Importing: ${place.Name}`);

      try {
        const slug = slugify(place.Name);

        // Debug: check what fields we have
        console.log(`   Story length: ${place.Story?.length || 0}`);
        console.log(`   Nudge length: ${place.Nudge?.length || 0}`);

        if (!place.Story || !place.Nudge) {
          console.log(`   ⚠️  Missing Story or Nudge - skipping`);
          failed++;
          continue;
        }

        // Parse tags
        const tags = place.Tags ? place.Tags.split(',').map(t => t.trim()) : [];

        // Generate embedding - pass as activity object
        console.log('   Generating embedding...');
        const activityObject = {
          name: place.Name,
          story: place.Story,
          nudge: place.Nudge,
          tags: tags
        };
        const embedding = await generateActivityEmbedding(activityObject);

        if (!embedding) {
          console.log('   ❌ Embedding generation returned null');
          failed++;
          continue;
        }

        const embeddingStr = `[${embedding.join(',')}]`;

        // Insert place
        await pool.query(`
          INSERT INTO places (
            id, city_id, name, slug, type, story, nudge,
            vibe_quiet, vibe_inside, vibe_active,
            tags, neighborhood, price_level,
            embedding, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::vector, $15
          )
        `, [
          parseInt(place.ID),
          cityId,
          place.Name,
          slug,
          place.Type.toLowerCase(),
          place.Story,
          place.Nudge,
          parseFloat(place['Vibe: Quiet']),
          parseFloat(place['Vibe: Inside']),
          parseFloat(place['Vibe: Active']),
          tags,
          place.Neighborhood,
          parseInt(place['Price Level']) || 1,
          embeddingStr,
          true
        ]);

        imported++;
        console.log('   ✅ Imported successfully');

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`\n✅ Import complete:`);
    console.log(`   ${imported} places imported`);
    console.log(`   ${failed} places failed\n`);

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importFromCSV();
