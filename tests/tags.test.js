import { describe, it, expect, beforeAll } from 'vitest';
import { normalizeTags, slugifyTag, VOCABULARY } from '../api/_lib/tags.js';
import { normalizeAllTags } from '../scripts/normalize-tags.js';
import { createTestDatabase } from './helpers/pglite.js';

describe('normalizeTags', () => {
  it('fixes spelling variants', () => {
    expect(slugifyTag(' Ice Skating ')).toBe('ice-skating');
    expect(normalizeTags(['date night', 'SUP'])).toEqual(['date-night', 'sup']);
  });

  it('folds aliases into the vocabulary', () => {
    expect(normalizeTags(['kids', 'family', 'unusual-options'])).toEqual(['kid-friendly', 'outside-my-norm']);
  });

  it('adds implied vocabulary tags but keeps the descriptive ones', () => {
    expect(normalizeTags(['music', 'live-music'])).toEqual(['music', 'friend-hangout', 'live-music']);
    expect(normalizeTags(['outdoor'])).toEqual(['outdoors', 'nature']);
  });

  it('is idempotent', () => {
    const once = normalizeTags(['Date Night', 'kids', 'art', 'lake views']);
    expect(normalizeTags(once)).toEqual(once);
  });

  it('only offers tags that exist in the vocabulary', () => {
    expect(VOCABULARY).not.toContain('dog-friendly');
    expect(VOCABULARY).not.toContain('unusual-options');
  });
});

describe('normalizeAllTags script', () => {
  let pool;

  beforeAll(async () => {
    ({ pool } = await createTestDatabase());
    await pool.query(`UPDATE places SET tags = ARRAY['date night', 'kids', 'quiet'] WHERE id = (SELECT MIN(id) FROM places)`);
  }, 60000);

  it('dry run reports but does not write', async () => {
    const summary = await normalizeAllTags(pool, { log: () => {} });
    expect(summary.places.changed).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT tags FROM places WHERE id = (SELECT MIN(id) FROM places)');
    expect(rows[0].tags).toEqual(['date night', 'kids', 'quiet']);
  });

  it('--apply writes normalized tags and a second run changes nothing', async () => {
    await normalizeAllTags(pool, { apply: true, log: () => {} });
    const { rows } = await pool.query('SELECT tags FROM places WHERE id = (SELECT MIN(id) FROM places)');
    expect(rows[0].tags).toEqual(['date-night', 'kid-friendly', 'quiet']);

    const again = await normalizeAllTags(pool, { log: () => {} });
    expect(again.places.changed).toBe(0);
  });
});
