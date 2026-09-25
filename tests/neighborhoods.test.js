import { describe, it, expect, beforeAll } from 'vitest';
import {
  findNeighborhood,
  detectNameField,
  cleanName,
  isVague,
  assignNeighborhoods,
} from '../scripts/assign-neighborhoods.js';
import { createTestDatabase } from './helpers/pglite.js';

// Axis-aligned boxes are plenty for testing [lng, lat] rings
const box = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const feature = (name, geometry) => ({ type: 'Feature', properties: { OBJECTID: 1, NA_NAME: name }, geometry });

const features = [
  // Big east-side box with a hole where a lake would be
  feature('EAST SIDE NEIGHBORHOOD ASSOCIATION', {
    type: 'Polygon',
    coordinates: [box(-89.40, 43.06, -89.30, 43.12), box(-89.36, 43.09, -89.34, 43.10)],
  }),
  // Smaller neighborhood inside it
  feature('Marquette Neighborhood Association', { type: 'Polygon', coordinates: [box(-89.37, 43.07, -89.35, 43.085)] }),
  // Two-part neighborhood
  feature('Tenney-Lapham', {
    type: 'MultiPolygon',
    coordinates: [[box(-89.50, 43.00, -89.48, 43.02)], [box(-89.46, 43.00, -89.44, 43.02)]],
  }),
];

describe('boundary lookup', () => {
  it('picks the most specific boundary containing the point', () => {
    expect(findNeighborhood(features, 43.08, -89.36, 'NA_NAME')).toBe('Marquette');
    expect(findNeighborhood(features, 43.11, -89.32, 'NA_NAME')).toBe('East Side');
  });

  it('respects holes and multipolygons', () => {
    expect(findNeighborhood(features, 43.095, -89.35, 'NA_NAME')).toBeNull(); // in the hole
    expect(findNeighborhood(features, 43.01, -89.45, 'NA_NAME')).toBe('Tenney-Lapham');
    expect(findNeighborhood(features, 43.01, -89.47, 'NA_NAME')).toBeNull(); // between the parts
  });

  it('finds the name field and tidies names', () => {
    expect(detectNameField(features)).toBe('NA_NAME');
    expect(cleanName('BAY CREEK NEIGHBORHOOD ASSOCIATION, INC.')).toBe('Bay Creek');
    expect(cleanName('Vilas Neighborhood Assn')).toBe('Vilas');
  });

  it('knows which existing neighborhoods are too vague to keep', () => {
    expect(isVague('Madison')).toBe(true);
    expect(isVague('Multiple locations')).toBe(true);
    expect(isVague(null)).toBe(true);
    expect(isVague('Willy Street')).toBe(false);
  });
});

describe('assignNeighborhoods (real Postgres)', () => {
  let pool;
  let ids;

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
    const { rows } = await pool.query('SELECT id FROM places ORDER BY id LIMIT 3');
    ids = rows.map(r => r.id);
    await pool.query('UPDATE places SET lat = NULL, lng = NULL');
    await pool.query(`UPDATE places SET neighborhood = 'Madison', lat = 43.08, lng = -89.36 WHERE id = $1`, [ids[0]]);
    await pool.query(`UPDATE places SET neighborhood = 'Willy Street', lat = 43.08, lng = -89.36 WHERE id = $1`, [ids[1]]);
    await pool.query(`UPDATE places SET neighborhood = NULL, lat = 44.5, lng = -88.0 WHERE id = $1`, [ids[2]]);
  }, 60000);

  const neighborhoodOf = async (id) => (await pool.query('SELECT neighborhood FROM places WHERE id = $1', [id])).rows[0].neighborhood;

  it('only fills vague neighborhoods, and only with --apply', async () => {
    const dry = await assignNeighborhoods(pool, features, { log: () => {} });
    expect(dry).toMatchObject({ checked: 3, changed: 1, kept: 1, noMatch: 1 });
    expect(await neighborhoodOf(ids[0])).toBe('Madison');

    await assignNeighborhoods(pool, features, { apply: true, log: () => {} });
    expect(await neighborhoodOf(ids[0])).toBe('Marquette');
    expect(await neighborhoodOf(ids[1])).toBe('Willy Street');
  });

  it('--overwrite replaces specific names too', async () => {
    await assignNeighborhoods(pool, features, { apply: true, overwrite: true, log: () => {} });
    expect(await neighborhoodOf(ids[1])).toBe('Marquette');
  });
});
