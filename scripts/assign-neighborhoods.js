/**
 * Assign neighborhoods from City of Madison boundary polygons
 *
 * Replaces vague neighborhoods ("Madison", "Downtown Madison", "Multiple
 * locations", missing) with the neighborhood association whose boundary
 * contains the place's coordinates.
 *
 * Usage:
 *   node scripts/assign-neighborhoods.js                  # dry run
 *   node scripts/assign-neighborhoods.js --apply          # write changes
 *   node scripts/assign-neighborhoods.js --overwrite      # replace every neighborhood, not just vague ones
 *   node scripts/assign-neighborhoods.js --geojson=./neighborhoods.geojson
 *   node scripts/assign-neighborhoods.js --name-field=NA_NAME
 *
 * Default source: the "Neighborhood Associations" layer on the City's ArcGIS
 * server. If that URL moves, download GeoJSON from
 * https://data-cityofmadison.opendata.arcgis.com/datasets/neighborhood-associations
 * and pass it with --geojson.
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

export const DEFAULT_SOURCE =
  'https://maps.cityofmadison.com/arcgis/rest/services/Planning/Development_Layers/MapServer/10/query' +
  '?where=1%3D1&outFields=*&outSR=4326&f=geojson';

const VAGUE = new Set([
  '', 'madison', 'madison wi', 'madison, wi', 'downtown madison', 'multiple locations',
  'various', 'east side', 'west side', 'east madison', 'west madison', 'north side', 'south side',
]);

export const isVague = (neighborhood) => neighborhood === null || neighborhood === undefined ||
  VAGUE.has(String(neighborhood).trim().toLowerCase());

// ---------------------------------------------------------------------------
// Geometry ([lng, lat] coordinates, as GeoJSON has them)
// ---------------------------------------------------------------------------

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

const polygonsOf = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
};

// Outer ring minus holes
const inPolygon = (lng, lat, [outer, ...holes]) =>
  inRing(lng, lat, outer) && !holes.some(hole => inRing(lng, lat, hole));

export function featureContains(feature, lat, lng) {
  return polygonsOf(feature.geometry).some(polygon => inPolygon(lng, lat, polygon));
}

export function featureArea(feature) {
  return polygonsOf(feature.geometry)
    .reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((h, r) => h + ringArea(r), 0), 0);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Pick the property holding the neighborhood name */
export function detectNameField(features) {
  const props = features.find(f => f.properties)?.properties || {};
  const keys = Object.keys(props).filter(k => typeof props[k] === 'string');
  return keys.find(k => /^(na_?name|neighb\w*_?name|assoc\w*_?name)$/i.test(k)) ||
    keys.find(k => /name/i.test(k)) ||
    null;
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** "MARQUETTE NEIGHBORHOOD ASSOCIATION" -> "Marquette" */
export function cleanName(name) {
  let cleaned = String(name).trim()
    .replace(/\s+(neighborhood|neighbourhood)?\s*(association|assn\.?|assoc\.?)(,?\s*inc\.?)?$/i, '')
    .replace(/\s+neighborhood$/i, '')
    .trim();
  if (cleaned === cleaned.toUpperCase()) cleaned = titleCase(cleaned);
  return cleaned.slice(0, 100);
}

/**
 * The most specific (smallest) boundary containing the point
 */
export function findNeighborhood(features, lat, lng, nameField) {
  let best = null;
  for (const feature of features) {
    const name = feature.properties?.[nameField];
    if (!name || !featureContains(feature, lat, lng)) continue;
    const area = featureArea(feature);
    if (!best || area < best.area) best = { name: cleanName(name), area };
  }
  return best?.name || null;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export async function assignNeighborhoods(pool, features, {
  nameField = detectNameField(features),
  apply = false,
  overwrite = false,
  log = console.log,
} = {}) {
  if (!nameField) throw new Error('Could not find a name field in the GeoJSON; pass --name-field');

  const { rows } = await pool.query(
    'SELECT id, name, neighborhood, lat, lng FROM places WHERE is_active = TRUE AND lat IS NOT NULL AND lng IS NOT NULL'
  );
  const summary = { checked: rows.length, changed: 0, noMatch: 0, kept: 0 };

  for (const place of rows) {
    if (!overwrite && !isVague(place.neighborhood)) {
      summary.kept++;
      continue;
    }

    const neighborhood = findNeighborhood(features, parseFloat(place.lat), parseFloat(place.lng), nameField);
    if (!neighborhood) {
      summary.noMatch++;
      continue;
    }
    if (neighborhood === place.neighborhood) continue;

    summary.changed++;
    log(`#${place.id} ${place.name}: ${place.neighborhood || '(none)'} -> ${neighborhood}`);
    if (apply) {
      await pool.query('UPDATE places SET neighborhood = $1, updated_at = NOW() WHERE id = $2', [neighborhood, place.id]);
    }
  }

  return summary;
}

async function loadFeatures(source) {
  const text = /^https?:\/\//.test(source)
    ? await (async () => {
      const response = await fetch(source, { headers: { 'User-Agent': 'IntentionalThingsFinder/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${source}`);
      return response.text();
    })()
    : await readFile(source, 'utf8');

  const geojson = JSON.parse(text);
  if (!Array.isArray(geojson.features)) {
    throw new Error(geojson.error ? `Server error: ${JSON.stringify(geojson.error)}` : 'Not a GeoJSON FeatureCollection');
  }
  return geojson.features;
}

async function main() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
  const pg = (await import('pg')).default;

  const args = process.argv.slice(2);
  const arg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const apply = args.includes('--apply');
  const overwrite = args.includes('--overwrite');

  const features = await loadFeatures(arg('geojson') || DEFAULT_SOURCE);
  const nameField = arg('name-field') || detectNameField(features);
  console.log(`🗺️  ${features.length} boundaries, using name field "${nameField}"\n`);

  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const summary = await assignNeighborhoods(pool, features, { nameField, apply, overwrite });
    console.log('\n', summary);
    console.log(apply ? '✅ Neighborhoods updated' : 'ℹ️  Dry run. Re-run with --apply to write changes.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('❌ Neighborhood assignment failed:', err.message);
    process.exit(1);
  });
}
