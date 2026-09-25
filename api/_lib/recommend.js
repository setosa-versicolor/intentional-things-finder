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

const toNumber = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Walk there, spend some time, walk back
 */
export function fitsTimeBudget(activity, timeAvailable) {
  if (activity.type !== 'place') return true;
  const walk = toNumber(activity.walk_minutes_from_center, null);
  if (walk === null) return true;
  return walk * 2 + MIN_STAY_MINUTES <= timeAvailable;
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
  const { timeAvailable, location } = preferences;
  const { date, season } = context;

  if (!matchesLocation(activity, location)) return false;
  if (!fitsTimeBudget(activity, timeAvailable)) return false;

  if (activity.type === 'event') {
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
  const walk = toNumber(activity.walk_minutes_from_center, null);
  if (walk !== null) {
    const timeRatio = (walk * 2 + MIN_STAY_MINUTES) / timeAvailable;
    if (timeRatio <= 0.8) availabilityScore = (1 - timeRatio) * 10;
  }
  breakdown.availabilityScore = round1(availabilityScore);

  // Weather and daylight (-45 to +14)
  breakdown.conditionsScore = conditionsScore(activity, context);

  // A little variety (5 points)
  breakdown.randomBonus = round1(random() * 5);

  score = breakdown.quietScore + breakdown.activeScore + tagScore + semanticScore +
    breakdown.timeBonus + availabilityScore + breakdown.conditionsScore + breakdown.randomBonus;

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
