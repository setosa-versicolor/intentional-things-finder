/**
 * Controlled tag vocabulary
 *
 * One list of tags people can pick, plus the rules that fold messy real-world
 * tags ("date night", "kids", "Outdoors") into it. Used by the UI, the
 * ranking, event ingestion and scripts/normalize-tags.js.
 */

// What people can choose from, in display order
export const TAG_OPTIONS = [
  { tag: 'solo-friendly', label: 'solo' },
  { tag: 'date-night', label: 'date night' },
  { tag: 'friend-hangout', label: 'with friends' },
  { tag: 'kid-friendly', label: 'with kids' },
  { tag: 'food-focused', label: 'food-focused' },
  { tag: 'cheap-eats', label: 'cheap eats' },
  { tag: 'free', label: 'free' },
  { tag: 'nature', label: 'nature' },
  { tag: 'creative', label: 'creative' },
  { tag: 'educational', label: 'learn something' },
  { tag: 'outside-my-norm', label: 'outside my norm' },
];

export const VOCABULARY = TAG_OPTIONS.map(o => o.tag);

// Different spellings of the same idea: replaced
const ALIASES = {
  kids: 'kid-friendly',
  family: 'kid-friendly',
  'family-friendly': 'kid-friendly',
  solo: 'solo-friendly',
  'unusual-options': 'outside-my-norm',
  unusual: 'outside-my-norm',
  unique: 'outside-my-norm',
  quirky: 'outside-my-norm',
  'cheap-eat': 'cheap-eats',
  outdoor: 'outdoors',
};

// Descriptive tags that also mean a vocabulary tag: kept, and the vocabulary tag added
const IMPLIES = {
  outdoors: 'nature',
  hiking: 'nature',
  trail: 'nature',
  lake: 'nature',
  music: 'friend-hangout',
  'live-music': 'friend-hangout',
  comedy: 'friend-hangout',
  nightlife: 'friend-hangout',
  social: 'friend-hangout',
  art: 'creative',
  theater: 'creative',
  'performing-arts': 'creative',
  crafts: 'creative',
  lectures: 'educational',
  education: 'educational',
  museum: 'educational',
  food: 'food-focused',
};

/** "Ice Skating " -> "ice-skating" */
export function slugifyTag(tag) {
  return String(tag)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Clean up a tag list: consistent spelling, aliases folded in, implied
 * vocabulary tags added, duplicates removed. Order is preserved.
 */
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const add = (t) => {
    if (t && !out.includes(t)) out.push(t);
  };

  for (const raw of tags) {
    const slug = slugifyTag(raw);
    const tag = ALIASES[slug] || slug;
    add(tag);
    add(IMPLIES[tag]);
  }
  return out;
}
