/**
 * Find places by name
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

const searchName = process.argv[2];

if (!searchName) {
  console.error('Usage: node scripts/find-place-by-name.js <search-name>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

try {
  const result = await pool.query(
    `SELECT id, name, business_status, google_place_id
     FROM places
     WHERE name ILIKE $1
     ORDER BY name`,
    [`%${searchName}%`]
  );

  if (result.rows.length === 0) {
    console.log(`No places found matching "${searchName}"`);
  } else {
    console.log(`Found ${result.rows.length} place(s):\n`);
    result.rows.forEach(place => {
      console.log(`ID: ${place.id}`);
      console.log(`Name: ${place.name}`);
      console.log(`Status: ${place.business_status || 'OPERATIONAL'}`);
      console.log(`Place ID: ${place.google_place_id || 'N/A'}`);
      console.log('');
    });
  }
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await pool.end();
}
