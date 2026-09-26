/**
 * One-tap moods and the time dial: plain choices that map onto the
 * sliders, tags and times the ranking already understands
 */

import { getLocalParts, fromLocalTime } from '../api/_lib/time.js';

export const DEFAULT_PREFERENCES = {
  quietToLively: 0.5,
  activeToRelaxing: 0.5,
  location: 'either',
  tags: [],
};

export const MOODS = [
  { id: 'think', label: 'Need to think', prefs: { quietToLively: 0.1, activeToRelaxing: 0.25, tags: ['solo-friendly'] } },
  { id: 'date', label: 'Date night', prefs: { quietToLively: 0.45, activeToRelaxing: 0.3, tags: ['date-night'] } },
  { id: 'kids', label: 'Kid energy to burn', prefs: { quietToLively: 0.8, activeToRelaxing: 0.85, tags: ['kid-friendly'] } },
  { id: 'rainy', label: 'Rainy afternoon', prefs: { quietToLively: 0.3, activeToRelaxing: 0.2, location: 'inside', tags: [] } },
  { id: 'visitor', label: 'Out-of-towner visiting', prefs: { quietToLively: 0.6, activeToRelaxing: 0.5, tags: ['outside-my-norm'] } },
  { id: 'cheap', label: 'Cheap & cheerful', prefs: { quietToLively: 0.6, activeToRelaxing: 0.5, tags: ['free', 'cheap-eats'] } },
  { id: 'surprise', label: 'Surprise me', prefs: null },
];

/**
 * Preferences for a mood. "Surprise me" rolls random vibes, so each tap
 * lands somewhere new.
 */
export function preferencesForMood(moodId, random = Math.random) {
  const mood = MOODS.find(m => m.id === moodId);
  if (!mood) return { ...DEFAULT_PREFERENCES };
  if (!mood.prefs) {
    return { ...DEFAULT_PREFERENCES, quietToLively: random(), activeToRelaxing: random() };
  }
  return { ...DEFAULT_PREFERENCES, ...mood.prefs };
}

// ---------------------------------------------------------------------------
// Time dial: "I have [1h / 2h / the evening / all day], starting [now / ...]"
// ---------------------------------------------------------------------------

const EVENING_ENDS = 23; // "the evening" runs until 11pm

export const DURATIONS = [
  { id: '1h', label: '1 hour' },
  { id: '2h', label: '2 hours' },
  { id: 'evening', label: 'the evening' },
  { id: 'day', label: 'all day' },
];

/** Minutes available for a duration choice, starting at `start` */
export function minutesFor(durationId, start = new Date()) {
  switch (durationId) {
    case '1h': return 60;
    case 'evening': {
      const { hour, minute } = getLocalParts(start);
      const left = (EVENING_ENDS - hour) * 60 - minute;
      return Math.max(120, left);
    }
    case 'day': return 8 * 60;
    default: return 120;
  }
}

const at = (date, hour, dayOffset = 0) => {
  const { year, month, day } = getLocalParts(new Date(date.getTime() + dayOffset * 24 * 60 * 60 * 1000));
  return fromLocalTime(year, month, day, hour);
};

/**
 * When to start: always "now", plus whichever of tonight / tomorrow /
 * Saturday still make sense from here. `date` is null for now.
 */
export function startOptions(now = new Date()) {
  const { hour, weekday } = getLocalParts(now);
  const options = [{ id: 'now', label: 'now', date: null }];

  if (hour < 17) options.push({ id: 'tonight', label: 'tonight', date: at(now, 19) });
  options.push({ id: 'tomorrow', label: 'tomorrow', date: at(now, 10, 1) });

  // Sunday = 0 ... Saturday = 6; skip when Saturday is today or tomorrow
  const daysToSaturday = (6 - weekday + 7) % 7;
  if (daysToSaturday > 1) options.push({ id: 'saturday', label: 'Saturday', date: at(now, 10, daysToSaturday) });

  return options;
}
