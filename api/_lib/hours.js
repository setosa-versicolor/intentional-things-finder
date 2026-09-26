/**
 * Hours checking utilities
 * Determines if a place is currently open based on hours data from Google
 */

import { getLocalParts } from './time.js';

const MINUTES_PER_WEEK = 7 * 24 * 60;

// Accepts { day, time: "0930" } (legacy / our stored format) or { day, hour, minute } (Places API New)
function toMinuteOfWeek(point) {
  let hour;
  let minute;
  if (point.time !== undefined && point.time !== null) {
    const t = parseInt(point.time, 10);
    hour = Math.floor(t / 100);
    minute = t % 100;
  } else {
    hour = point.hour ?? 0;
    minute = point.minute ?? 0;
  }
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return point.day * 24 * 60 + hour * 60 + minute;
}

/**
 * Check if a place is open at a given moment (Madison local time)
 * @param {Object} hours - Hours object from Google Places API
 * @param {Date} checkTime - Time to check (defaults to now)
 * @returns {boolean} - True if open or unknown, false if known closed
 */
export function isOpenAt(hours, checkTime = new Date()) {
  if (!hours) return true;

  if (hours.type === 'always_open' || hours.always_open) {
    return true;
  }

  if (!hours.periods || hours.periods.length === 0) {
    // No hours data - assume it might be open
    return true;
  }

  const { weekday, hour, minute } = getLocalParts(checkTime);
  const now = weekday * 24 * 60 + hour * 60 + minute;

  let usablePeriods = 0;
  for (const period of hours.periods) {
    if (!period.open) continue;

    // A single open period with no close means open 24/7
    if (!period.close) return true;

    const start = toMinuteOfWeek(period.open);
    let end = toMinuteOfWeek(period.close);
    if (start === null || end === null) continue;
    usablePeriods++;

    // Periods that wrap past Saturday night into Sunday
    if (end <= start) end += MINUTES_PER_WEEK;

    if ((now >= start && now < end) ||
        (now + MINUTES_PER_WEEK >= start && now + MINUTES_PER_WEEK < end)) {
      return true;
    }
  }

  // Malformed data shouldn't hide a place
  return usablePeriods === 0;
}

/**
 * When does the open period containing `checkTime` end?
 * @returns {Date|null} closing time, or null if closed, 24/7 or unknown
 */
export function getClosingTime(hours, checkTime = new Date()) {
  if (!hours || hours.always_open || !hours.periods) return null;

  const { weekday, hour, minute } = getLocalParts(checkTime);
  const now = weekday * 24 * 60 + hour * 60 + minute;

  for (const period of hours.periods) {
    if (!period.open || !period.close) continue;
    const start = toMinuteOfWeek(period.open);
    let end = toMinuteOfWeek(period.close);
    if (start === null || end === null) continue;
    if (end <= start) end += MINUTES_PER_WEEK;

    for (const t of [now, now + MINUTES_PER_WEEK]) {
      if (t >= start && t < end) {
        const closing = new Date(checkTime.getTime() + (end - t) * 60 * 1000);
        closing.setSeconds(0, 0);
        return closing;
      }
    }
  }

  return null;
}

/**
 * Check if a place is open when you'd arrive and stays open long enough to enjoy it
 * @param {Object} hours
 * @param {Date} arrival
 * @param {number} minStayMinutes
 */
export function isOpenForVisit(hours, arrival = new Date(), minStayMinutes = 30) {
  const leaving = new Date(arrival.getTime() + minStayMinutes * 60 * 1000);
  return isOpenAt(hours, arrival) && isOpenAt(hours, leaving);
}

/** @deprecated use isOpenAt */
export function isCurrentlyOpen(hours, checkTime = new Date()) {
  return isOpenAt(hours, checkTime);
}

/**
 * Get a human-readable status message
 * @param {Object} hours - Hours object
 * @param {Date} checkTime - Time to check
 * @returns {string} - Status message like "Open now" or "Closed"
 */
export function getHoursStatus(hours, checkTime = new Date()) {
  if (hours?.always_open) {
    return 'Open 24 hours';
  }

  if (!hours || !hours.weekday_text) {
    return 'Hours not available';
  }

  return isOpenAt(hours, checkTime) ? 'Open now' : 'Closed now';
}

/**
 * Get the hours for a given day as a readable string
 * @param {Object} hours - Hours object
 * @param {Date} date - Day to describe (Madison local)
 * @returns {string|null} - e.g. "7:00 AM – 6:00 PM", or null if unknown
 */
export function getTodaysHours(hours, date = new Date()) {
  if (!hours) return null;

  if (hours.always_open) {
    return 'Open 24 hours';
  }

  if (!hours.weekday_text || hours.weekday_text.length !== 7) {
    return null;
  }

  // Google's weekday_text starts on Monday
  const { weekday } = getLocalParts(date);
  const text = hours.weekday_text[(weekday + 6) % 7];
  if (!text) return null;

  // Extract just the hours part after the colon
  return text.split(': ').slice(1).join(': ') || text;
}

/**
 * Check if hours appear to be seasonal or temporary
 * @param {Object} hours - Hours object
 * @returns {boolean} - True if hours may be seasonal
 */
export function hasSeasonalHours(hours) {
  if (!hours || !hours.weekday_text) {
    return false;
  }

  // Look for seasonal keywords in the hours text
  const seasonalKeywords = [
    'seasonal',
    'weather permitting',
    'spring',
    'summer',
    'fall',
    'winter',
    'memorial day',
    'labor day',
    'may through',
    'april through',
    'closed for season'
  ];

  const hoursText = hours.weekday_text.join(' ').toLowerCase();

  return seasonalKeywords.some(keyword => hoursText.includes(keyword));
}

/**
 * Check if a place closes early (before 6 PM) consistently
 * Useful for identifying daylight-dependent places like parks
 * @param {Object} hours - Hours object
 * @returns {boolean} - True if place typically closes early
 */
export function closesEarly(hours) {
  if (!hours || !hours.periods || hours.periods.length === 0) {
    return false;
  }

  if (hours.always_open) {
    return false;
  }

  // Check if most closing times are before 1800 (6 PM)
  const closeTimes = hours.periods
    .filter(p => p.close && p.close.time)
    .map(p => parseInt(p.close.time));

  if (closeTimes.length === 0) {
    return false;
  }

  const earlyCloses = closeTimes.filter(time => time < 1800);

  // If more than 50% of days close before 6 PM, consider it "closes early"
  return earlyCloses.length > closeTimes.length / 2;
}
