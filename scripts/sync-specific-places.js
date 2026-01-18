/**
 * Sync specific places by ID
 * Usage: node scripts/sync-specific-places.js 131 8
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
import {
  getPlaceDetails,
  formatHours,
  getHoursSummary
} from '../api/_lib/google-places.js';

const { Pool } = pg;

const placeIds = process.argv.slice(2).map(id => parseInt(id));

if (placeIds.length === 0) {
  console.error('Usage: node scripts/sync-specific-places.js <place-id> [<place-id> ...]');
  console.error('Example: node scripts/sync-specific-places.js 131 8');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

try {
  console.log(`🔄 Syncing ${placeIds.length} place(s)...\n`);

  for (const placeId of placeIds) {
    const result = await pool.query(
      'SELECT id, name, google_place_id FROM places WHERE id = $1',
      [placeId]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Place ID ${placeId} not found\n`);
      continue;
    }

    const place = result.rows[0];
    console.log(`📍 ${place.name} (ID: ${place.id})`);

    if (!place.google_place_id) {
      console.log('   ⚠️  No Google Place ID - skipping\n');
      continue;
    }

    try {
      console.log('   Fetching place details...');
      const details = await getPlaceDetails(place.google_place_id);

      if (!details) {
        console.log('   ❌ Could not fetch place details\n');
        continue;
      }

      const hours = formatHours(details.opening_hours);
      const hoursSummary = getHoursSummary(hours);

      console.log(`   ✓ Hours: ${hoursSummary}`);

      await pool.query(
        `UPDATE places
         SET hours = $1,
             website = COALESCE(website, $2),
             phone = COALESCE(phone, $3),
             google_rating = $4,
             google_user_ratings_total = $5,
             business_status = $6,
             last_synced_at = NOW()
         WHERE id = $7`,
        [
          JSON.stringify(hours),
          details.website || null,
          details.formatted_phone_number || null,
          details.rating || null,
          details.user_ratings_total || null,
          details.business_status || 'OPERATIONAL',
          place.id
        ]
      );

      if (details.rating) {
        console.log(`   ✓ Rating: ${details.rating} (${details.user_ratings_total} reviews)`);
      }

      if (details.business_status === 'CLOSED_PERMANENTLY') {
        console.log(`   ⚠️  PERMANENTLY CLOSED`);
      } else if (details.business_status === 'CLOSED_TEMPORARILY') {
        console.log(`   ⚠️  Temporarily closed`);
      } else {
        console.log(`   ✓ Status: ${details.business_status || 'OPERATIONAL'}`);
      }

      console.log('   ✅ Synced successfully\n');

      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }

  console.log('✅ Sync complete');

} catch (error) {
  console.error('❌ Sync failed:', error.message);
  process.exit(1);
} finally {
  await pool.end();
}
