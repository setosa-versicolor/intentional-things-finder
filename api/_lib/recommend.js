/**
 * Recommendation ranking
 *
 * Pure functions (no database, no network) so the same logic runs in the
 * API, the offline fallback in the browser, and the test suite.
 *
 * Activities use the shape of the `activities` view: title, vibe_quiet,
 * vibe_inside, vibe_active, tags, best_times, walk_minutes_from_center,
 * start_time, end_time, hours, seasons, type ('place' | 'event').
 */

import { getTimeOfDay, getSeason } from './time.js';
import { isOpenForVisit } from './hours.js';
import { normalizeTags } from './tags.js';
import { getSunTimes, isDark, isGoldenHour } from './sun.js';

// Minimum time worth spending somewhere once you arrive
export const MIN_STAY_MINUTES = 30;

// Triaged events scoring below this are never suggested
export const MIN_TRIAGE_SCORE = 0.35;

const toNumber = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
};

const round1 = (n) => Math.round(n * 10) / 10;

export const activityKey = (activity) => `${activity.type}-${activity.id}`;

// ---------------------------------------------------------------------------
// Getting there
// ---------------------------------------------------------------------------

/** Straight-line distance in km between two {lat, lng} points */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Streets aren't straight lines
const DETOUR = 1.25;
const WALK_KMH = 4.8;
const BIKE_KMH = 15;
const DRIVE_KMH = 35;
const PARKING_MINUTES = 5;
const MAX_WALK_MINUTES = 20;
const MAX_BIKE_MINUTES = 20;

/**
 * How someone would realistically get there from `origin`: walk if it's
 * close, bike if it's a short ride, otherwise drive.
 * @returns {{mode: 'walk'|'bike'|'drive', minutes: number}|null}
 */
export function travelFrom(origin, activity) {
  const lat = toNumber(activity.lat, null);
  const lng = toNumber(activity.lng, null);
  if (!origin || lat === null || lng === null) return null;

  const km = distanceKm(origin, { lat, lng }) * DETOUR;
  const walk = Math.max(1, Math.round((km / WALK_KMH) * 60));
  if (walk <= MAX_WALK_MINUTES) return { mode: 'walk', minutes: walk };
  const bike = Math.round((km / BIKE_KMH) * 60);
  if (bike <= MAX_BIKE_MINUTES) return { mode: 'bike', minutes: bike };
  return { mode: 'drive', minutes: Math.round((km / DRIVE_KMH) * 60) + PARKING_MINUTES };
}

/**
 * One-way minutes to get there: from the person when we know where they
 * are, otherwise the stored walk from the Capitol. Null when unknown.
 */
export function travelMinutes(activity, origin) {
  const travel = travelFrom(origin, activity);
  if (travel) return travel.minutes;
  return activity.type === 'place' ? toNumber(activity.walk_minutes_from_center, null) : null;
}

/**
 * Get there, spend some time, get back
 */
export function fitsTimeBudget(activity, timeAvailable, origin = null) {
  const minutes = travelMinutes(activity, origin);
  if (minutes === null) return true;
  return minutes * 2 + MIN_STAY_MINUTES <= timeAvailable;
}

export function matchesLocation(activity, location) {
  const inside = toNumber(activity.vibe_inside, 0.5);
  if (location === 'inside') return inside >= 0.6;
  if (location === 'outside') return inside <= 0.4;
  return true;
}

export function inSeason(activity, season) {
  const seasons = activity.seasons;
  if (!Array.isArray(seasons) || seasons.length === 0) return true;
  return seasons.includes(season);
}

/**
 * An event fits if it starts within the time window, or is already running
 * and will keep going long enough to be worth showing up for.
 */
export function eventInWindow(activity, windowStart, timeAvailable) {
  if (!activity.start_time) return false;

  const start = new Date(activity.start_time).getTime();
  const from = windowStart.getTime();
  const latestStart = from + (timeAvailable - MIN_STAY_MINUTES) * 60 * 1000;

  if (start >= from && start <= latestStart) return true;

  if (start < from && activity.end_time) {
    const end = new Date(activity.end_time).getTime();
    return end >= from + MIN_STAY_MINUTES * 60 * 1000;
  }

  return false;
}

/**
 * Hard filters: anything that would make a suggestion wrong, not just weak
 */
export function isEligible(activity, preferences, context) {
  const { timeAvailable, location, origin = null, exclude = [] } = preferences;
  const { date, season } = context;

  // Already on screen, or swapped away
  if (exclude.length > 0 && exclude.includes(activityKey(activity))) return false;
  if (!matchesLocation(activity, location)) return false;
  if (!fitsTimeBudget(activity, timeAvailable, origin)) return false;

  if (activity.type === 'event') {
    // Triaged as not worth an outing (see api/_lib/event-triage.js)
    const triageScore = toNumber(activity.triage_score, null);
    if (triageScore !== null && triageScore < MIN_TRIAGE_SCORE) return false;
    return eventInWindow(activity, date, timeAvailable);
  }

  if (!inSeason(activity, season)) return false;
  if (activity.hours && !isOpenForVisit(activity.hours, date, MIN_STAY_MINUTES)) return false;

  return true;
}

/**
 * Soft scoring: how well an eligible activity matches the mood
 */
export function scoreActivity(activity, preferences, context) {
  const { quietToLively, activeToRelaxing, tags = [], timeAvailable } = preferences;
  const { timeOfDay, semanticScores, random } = context;
  const breakdown = {};
  let score = 0;

  // Vibe matching (40 points)
  // vibe_quiet is 1 = quiet, but the slider runs 0 = quiet -> 1 = lively
  const wantedQuiet = 1 - quietToLively;
  const quietMatch = 1 - Math.abs(toNumber(activity.vibe_quiet, 0.5) - wantedQuiet);
  breakdown.quietScore = round1(quietMatch * 20);

  // vibe_active and the slider both run 0 = relaxing -> 1 = active
  const activeMatch = 1 - Math.abs(toNumber(activity.vibe_active, 0.5) - activeToRelaxing);
  breakdown.activeScore = round1(activeMatch * 20);

  // Tag matching (30 points)
  let tagScore = 0;
  if (tags.length > 0 && Array.isArray(activity.tags)) {
    // Normalize here too, so unmigrated rows ("date night", "kids") still match
    const activityTags = normalizeTags(activity.tags);
    const matching = normalizeTags(tags).filter(tag => activityTags.includes(tag));
    tagScore = (matching.length / tags.length) * 30;
  }
  breakdown.tagScore = round1(tagScore);

  // Semantic similarity (30 points), only when embeddings are available
  let semanticScore = 0;
  const similarity = semanticScores?.get(`${activity.type}-${activity.id}`);
  if (similarity !== undefined) {
    semanticScore = similarity * 30;
  }
  breakdown.semanticScore = round1(semanticScore);

  // Right time of day (20 points)
  breakdown.timeBonus = Array.isArray(activity.best_times) && activity.best_times.includes(timeOfDay) ? 20 : 0;

  // Comfortable fit in the time available (up to 10 points)
  let availabilityScore = 0;
  const travel = travelMinutes(activity, preferences.origin);
  if (travel !== null) {
    const timeRatio = (travel * 2 + MIN_STAY_MINUTES) / timeAvailable;
    if (timeRatio <= 0.8) availabilityScore = (1 - timeRatio) * 10;
  }
  breakdown.availabilityScore = round1(availabilityScore);

  // Seen lately, or went and didn't love it (from this device's history)
  const key = activityKey(activity);
  breakdown.historyScore =
    (preferences.disliked?.includes(key) ? -30 : 0) +
    (preferences.recent?.includes(key) ? -12 : 0);

  // How worth recommending a triaged event is (-2.4 to +8)
  const triageScore = toNumber(activity.triage_score, null);
  breakdown.triageScore = triageScore === null ? 0 : round1((triageScore - 0.5) * 16);

  // Weather and daylight (-45 to +14)
  breakdown.conditionsScore = conditionsScore(activity, context);

  // A little variety (5 points)
  breakdown.randomBonus = round1(random() * 5);

  score = breakdown.quietScore + breakdown.activeScore + tagScore + semanticScore +
    breakdown.timeBonus + availabilityScore + breakdown.triageScore + breakdown.conditionsScore +
    breakdown.historyScore + breakdown.randomBonus;

  return { score: round1(score), breakdown };
}

const WEATHER_SCORES = {
  //        outdoor, indoor
  bad:   [-25, 5],
  meh:   [-10, 2],
  ok:    [0, 0],
  great: [8, -2],
};

/**
 * Nudge outdoor picks up or down for the weather and the light.
 * Soft scoring only: a rainy-day park can still win if nothing else fits.
 */
export function conditionsScore(activity, context) {
  const { weather, sun, date } = context;
  const inside = toNumber(activity.vibe_inside, 0.5);
  const outdoor = inside <= 0.4;
  const indoor = inside >= 0.6;
  let score = 0;

  if (weather) {
    let rating = weather.rating;
    // Cold and snow are the point of sledding and skating
    const winterActivity = Array.isArray(activity.seasons) && activity.seasons.includes('winter');
    if (winterActivity && rating !== 'bad' && !/rain|showers|drizzle/i.test(weather.shortForecast)) {
      rating = 'ok';
    }
    const [outdoorScore, indoorScore] = WEATHER_SCORES[rating] || WEATHER_SCORES.ok;
    if (outdoor) score += outdoorScore;
    if (indoor) score += indoorScore;
  }

  // Unlit nature spots: skip after dark, favor golden hour
  if (sun && outdoor && activity.type === 'place' && normalizeTags(activity.tags).includes('nature')) {
    if (isDark(date, sun)) score -= 20;
    else if (isGoldenHour(date, sun)) score += 6;
  }

  return score;
}

/**
 * Build the context for a request. Everything time-based is Madison-local.
 * @param {Object} [options.weather] - weatherAt() summary for the requested time, if known
 */
export function buildContext({ date = new Date(), semanticScores = null, random = Math.random, weather = null } = {}) {
  return {
    date,
    timeOfDay: getTimeOfDay(date),
    season: getSeason(date),
    sun: getSunTimes(date),
    weather,
    semanticScores,
    random,
  };
}

/**
 * Filter, score and pick the top activities
 * @returns {Array} activities with `score` and `scoreBreakdown`, best first
 */
export function rankActivities(activities, preferences, context, limit = 3) {
  return activities
    .filter(activity => isEligible(activity, preferences, context))
    .map(activity => {
      const { score, breakdown } = scoreActivity(activity, preferences, context);
      return { ...activity, score, scoreBreakdown: breakdown };
    })
    .filter(activity => activity.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Card roles: three different kinds of idea, not three cafés
// ---------------------------------------------------------------------------

export const ROLES = ['sure-thing', 'something-different', 'wildcard'];

// Places are grouped by their type (café, park, bar...); events are one group
export const categoryOf = (activity) =>
  activity.type === 'event' ? 'event' : (activity.category || 'place');

// How much less a card may score and still win a slot for being different
const WILDCARD_BONUS = 12;

const isWild = (activity) =>
  activity.type === 'event' ||
  normalizeTags(activity.tags).includes('outside-my-norm') ||
  toNumber(activity.triage_score, 0) >= 0.8;

/**
 * Choose cards from a best-first list so each one earns its slot:
 *   1. sure-thing: the best match
 *   2. something-different: the best match of another kind, ideally in another neighborhood
 *   3. wildcard: an event, something off the beaten path, or at least a third kind
 * Falls back to the next best when there isn't enough variety.
 *
 * `avoidCategories` fills one slot during a swap: skip the kinds already on screen.
 */
export function pickWithRoles(ranked, { count = 3, avoidCategories = [], role = null } = {}) {
  const picks = [];
  const pool = [...ranked];
  const take = (activity, pickRole) => {
    pool.splice(pool.indexOf(activity), 1);
    picks.push({ ...activity, role: pickRole });
  };
  const used = () => new Set([...avoidCategories, ...picks.map(categoryOf)]);
  const fresh = (a) => !used().has(categoryOf(a));

  const roles = role ? [role] : ROLES.slice(0, count);
  for (const slot of roles) {
    if (pool.length === 0) break;
    let pick;
    if (slot === 'wildcard') {
      const bonus = (a) => a.score + (isWild(a) ? WILDCARD_BONUS : 0) + (fresh(a) ? WILDCARD_BONUS / 2 : 0);
      pick = [...pool].sort((a, b) => bonus(b) - bonus(a))[0];
    } else if (slot === 'something-different') {
      const hoods = new Set(picks.map(p => p.neighborhood).filter(Boolean));
      pick = pool.find(a => fresh(a) && !hoods.has(a.neighborhood)) || pool.find(fresh);
    } else {
      pick = pool.find(fresh);
    }
    take(pick || pool[0], slot);
  }

  // More than three asked for: the rest in score order
  while (picks.length < count && pool.length > 0 && !role) take(pool[0], null);
  return picks;
}

/**
 * Everything the API and the offline fallback need: eligible, scored,
 * picked by role, with travel details for the card
 */
export function recommend(activities, preferences, context, options = {}) {
  const ranked = rankActivities(activities, preferences, context, Infinity);
  return pickWithRoles(ranked, options).map(activity => ({
    ...activity,
    category: categoryOf(activity),
    travel: travelFrom(preferences.origin, activity),
  }));
}
