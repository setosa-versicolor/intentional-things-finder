/**
 * Sync place data from Google Places API
 *
 * This script:
 * 1. Finds Google Place IDs for places missing them
 * 2. Fetches current hours and details from Google
 * 3. Updates the database with synced data
 *
 * Usage:
 *   node scripts/sync-google-places.js [--all] [--limit=10]
 *
 * Options:
 *   --all: Sync all places, even those already synced
 *   --limit=N: Only sync N places (useful for testing)
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
import {
  findPlaceId,
  getPlaceDetails,
  formatHours,
  getHoursSummary
} from '../api/_lib/google-places.js';

const { Pool } = pg;

async function syncGooglePlaces() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    // Check if API key is set
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      console.error('❌ GOOGLE_PLACES_API_KEY not set in environment');
      console.error('   Get a key from: https://console.cloud.google.com/google/maps-apis/');
      console.error('   Add to .env.local: GOOGLE_PLACES_API_KEY=your_key_here');
      process.exit(1);
    }

    // Parse command line args
    const args = process.argv.slice(2);
    const syncAll = args.includes('--all');
    const limitMatch = args.find(arg => arg.startsWith('--limit='));
    const limit = limitMatch ? parseInt(limitMatch.split('=')[1]) : null;

    console.log('🔄 Syncing places with Google Places API...\n');

    // Query for places that need syncing
    let query = `
      SELECT id, name, neighborhood, address, lat, lng, google_place_id
      FROM places
      WHERE is_active = TRUE
    `;

    if (!syncAll) {
      query += ` AND (google_place_id IS NULL OR last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '7 days')`;
    }

    query += ` ORDER BY id`;

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await pool.query(query);
    console.log(`Found ${result.rows.length} places to sync\n`);

    if (result.rows.length === 0) {
      console.log('✅ All places are already synced!');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const place of result.rows) {
      console.log(`\n📍 ${place.name} (ID: ${place.id})`);

      try {
        // Step 1: Find Place ID if we don't have one
        let placeId = place.google_place_id;

        if (!placeId) {
          console.log('   Looking up Place ID...');
          const searchResult = await findPlaceId(
            place.name,
            place.address || place.neighborhood || 'Madison, WI',
            place.lat,
            place.lng
          );

          if (searchResult) {
            placeId = searchResult.place_id;
            console.log(`   ✓ Found Place ID: ${placeId}`);

            // Update the address and coordinates if Google has better data
            if (searchResult.address && !place.address) {
              await pool.query(
                'UPDATE places SET address = $1 WHERE id = $2',
                [searchResult.address, place.id]
              );
              console.log(`   ✓ Updated address: ${searchResult.address}`);
            }

            if (searchResult.lat && searchResult.lng && (!place.lat || !place.lng)) {
              await pool.query(
                'UPDATE places SET lat = $1, lng = $2 WHERE id = $3',
                [searchResult.lat, searchResult.lng, place.id]
              );
              console.log(`   ✓ Updated coordinates`);
            }
          } else {
            console.log('   ⚠️  Could not find Place ID');
            failed++;
            continue;
          }
        }

        // Step 2: Fetch place details
        console.log('   Fetching place details...');
        const details = await getPlaceDetails(placeId);

        if (!details) {
          console.log('   ⚠️  Could not fetch place details');
          failed++;
          continue;
        }

        // Step 3: Format and update hours
        const hours = formatHours(details.opening_hours);
        const hoursSummary = getHoursSummary(hours);

        console.log(`   ✓ Hours: ${hoursSummary}`);

        // Step 4: Update database
        await pool.query(
          `UPDATE places
           SET google_place_id = $1,
               hours = $2,
               website = COALESCE(website, $3),
               phone = COALESCE(phone, $4),
               google_rating = $5,
               google_user_ratings_total = $6,
               lat = COALESCE(lat, $7),
               lng = COALESCE(lng, $8),
               business_status = $9,
               last_synced_at = NOW()
           WHERE id = $10`,
          [
            placeId,
            JSON.stringify(hours),
            details.website || null,
            details.formatted_phone_number || null,
            details.rating || null,
            details.user_ratings_total || null,
            details.geometry?.location?.lat || null,
            details.geometry?.location?.lng || null,
            details.business_status || 'OPERATIONAL',
            place.id
          ]
        );

        if (details.rating) {
          console.log(`   ✓ Rating: ${details.rating} (${details.user_ratings_total} reviews)`);
        }

        // Log if permanently closed
        if (details.business_status === 'CLOSED_PERMANENTLY') {
          console.log(`   ⚠️  PERMANENTLY CLOSED`);
        } else if (details.business_status === 'CLOSED_TEMPORARILY') {
          console.log(`   ⚠️  Temporarily closed`);
        }

        updated++;
        console.log('   ✅ Synced successfully');

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`   ❌ Error syncing ${place.name}:`, error.message);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`\n✅ Sync complete:`);
    console.log(`   ${updated} places updated`);
    console.log(`   ${failed} places failed\n`);

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

syncGooglePlaces();
