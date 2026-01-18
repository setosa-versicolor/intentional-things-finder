/**
 * Export all places to Excel spreadsheet
 *
 * Usage: node scripts/export-to-excel.js
 */

import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

import pg from 'pg';

const { Pool } = pg;

async function exportToExcel() {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    console.log('📊 Exporting places to CSV...\n');

    // Fetch all places
    const result = await pool.query(`
      SELECT
        id,
        name,
        type,
        neighborhood,
        story,
        nudge,
        vibe_quiet,
        vibe_inside,
        vibe_active,
        tags,
        price_level,
        CASE WHEN embedding IS NOT NULL THEN 'Yes' ELSE 'No' END as has_embedding,
        is_active,
        created_at
      FROM places
      ORDER BY type, name
    `);

    console.log(`Found ${result.rows.length} places\n`);

    // Convert to CSV
    const headers = [
      'ID',
      'Name',
      'Type',
      'Neighborhood',
      'Story',
      'Nudge',
      'Vibe: Quiet',
      'Vibe: Inside',
      'Vibe: Active',
      'Tags',
      'Price Level',
      'Has Embedding',
      'Active',
      'Created At'
    ];

    const csvRows = [headers.join(',')];

    for (const place of result.rows) {
      const row = [
        place.id,
        `"${(place.name || '').replace(/"/g, '""')}"`,
        place.type || '',
        `"${(place.neighborhood || '').replace(/"/g, '""')}"`,
        `"${(place.story || '').replace(/"/g, '""')}"`,
        `"${(place.nudge || '').replace(/"/g, '""')}"`,
        place.vibe_quiet || '',
        place.vibe_inside || '',
        place.vibe_active || '',
        `"${(place.tags || []).join(', ')}"`,
        place.price_level || '',
        place.has_embedding,
        place.is_active ? 'Yes' : 'No',
        place.created_at ? new Date(place.created_at).toISOString().split('T')[0] : ''
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');
    const outputPath = 'discover-madison-places.csv';

    fs.writeFileSync(outputPath, csvContent, 'utf-8');

    console.log(`✅ Exported ${result.rows.length} places to ${outputPath}`);
    console.log('\nYou can open this file in Excel, Google Sheets, or any spreadsheet program.\n');

    // Print summary by type
    console.log('📊 Summary by Type:');
    const typeCounts = {};
    for (const place of result.rows) {
      typeCounts[place.type] = (typeCounts[place.type] || 0) + 1;
    }

    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   ${type.padEnd(15)} ${count} places`);
      });

  } catch (err) {
    console.error('❌ Export failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

exportToExcel();
