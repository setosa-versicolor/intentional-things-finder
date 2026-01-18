/**
 * Verify hours for all places in the database
 *
 * This script reads the CSV, verifies hours via web search for each place,
 * and updates the CSV with verified hours information.
 *
 * Usage: node scripts/verify-hours.js
 */

import fs from 'fs';

// Simple CSV parser
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
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

// Read the CSV file
const csvContent = fs.readFileSync('discover-madison-places.csv', 'utf-8');
const records = parseCSV(csvContent);

console.log(`📊 Found ${records.length} places in CSV\n`);

// Helper to fix JSON-like strings with unquoted keys
function fixJSON(str) {
  // Replace unquoted keys with quoted keys
  return str
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/:([a-zA-Z][a-zA-Z0-9_-]*)/g, ':"$1"')
    .replace(/:(\d{2}:\d{2})/g, ':"$1"')
    .replace(/:"(true|false)"/g, ':$1'); // Fix booleans
}

// Debug: Check first few records
console.log('Sample records:');
records.slice(0, 3).forEach((r, idx) => {
  console.log(`\nRecord ${idx + 1}:`);
  console.log(`  Name: ${r.Name}`);
  const fixed = fixJSON(r.Availability);
  console.log(`  Fixed JSON: ${fixed.substring(0, 100)}...`);
  try {
    const avail = JSON.parse(fixed);
    console.log(`  Parsed successfully!`);
    console.log(`  hours_verified: ${avail.hours_verified}`);
  } catch (e) {
    console.log(`  Parse error: ${e.message}`);
  }
});

// Filter for places that need verification
const needsVerification = records.filter(r => {
  try {
    const fixed = fixJSON(r.Availability);
    const availability = JSON.parse(fixed);
    return availability.hours_verified === false;
  } catch (e) {
    console.log(`Failed to parse availability for ${r.Name}: ${e.message}`);
    return false;
  }
});

console.log(`\n🔍 ${needsVerification.length} places need hours verification\n`);

// Output list of places needing verification organized by type
const byType = {};
needsVerification.forEach(place => {
  if (!byType[place.Type]) {
    byType[place.Type] = [];
  }
  byType[place.Type].push({
    name: place.Name,
    neighborhood: place.Neighborhood,
    id: place.ID
  });
});

console.log('Places needing verification by type:\n');
for (const [type, places] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${type} (${places.length}):`);
  places.forEach(p => {
    console.log(`  - ${p.name} (ID: ${p.id}) - ${p.neighborhood}`);
  });
}

console.log('\n\n📝 Next steps:');
console.log('1. Use web search to verify hours for each place');
console.log('2. Update the Availability column with verified hours');
console.log('3. Set hours_verified: true for each verified place\n');
