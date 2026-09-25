/**
 * Madison-local time helpers
 *
 * Serverless functions run in UTC, so anything that depends on the
 * wall clock in Madison (time of day, opening hours, seasons) must be
 * computed explicitly in America/Chicago rather than with getHours().
 */

export const CITY_TIMEZONE = 'America/Chicago';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CITY_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  weekday: 'long',
  hourCycle: 'h23',
});

/**
 * Break a Date into its Madison wall-clock components
 * @param {Date} date
 * @returns {{year, month, day, hour, minute, weekday, hhmm}}
 *   month is 0-11, weekday is 0 (Sunday) - 6, hhmm is e.g. 930 for 9:30am
 */
export function getLocalParts(date = new Date()) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map(p => [p.type, p.value])
  );
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10) - 1,
    day: parseInt(parts.day, 10),
    hour,
    minute,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hhmm: hour * 100 + minute,
  };
}

/**
 * Convert a Madison wall-clock time to a real Date (UTC instant)
 * Handles CST/CDT automatically.
 */
export function fromLocalTime(year, month, day, hour = 0, minute = 0) {
  // Start by pretending the wall time is UTC, then correct by the zone offset
  const guess = Date.UTC(year, month, day, hour, minute);
  const offsetAt = (ms) => {
    const p = getLocalParts(new Date(ms));
    return Date.UTC(p.year, p.month, p.day, p.hour, p.minute) - ms;
  };
  // Two passes settle correctly around DST transitions
  let ts = guess - offsetAt(guess);
  ts = guess - offsetAt(ts);
  return new Date(ts);
}

export function getTimeOfDay(date = new Date()) {
  const { hour } = getLocalParts(date);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function getSeason(date = new Date()) {
  const { month } = getLocalParts(date);
  if (month >= 2 && month <= 4) return 'spring'; // Mar-May
  if (month >= 5 && month <= 7) return 'summer'; // Jun-Aug
  if (month >= 8 && month <= 10) return 'fall';  // Sep-Nov
  return 'winter';                               // Dec-Feb
}

export function getDayOfWeek(date = new Date()) {
  return WEEKDAYS[getLocalParts(date).weekday].toLowerCase();
}

/**
 * Parse an ICS DTSTART/DTEND value.
 * - "20260925T190000Z" is UTC
 * - "20260925T190000" (floating or TZID=America/Chicago) is Madison local time
 * - "20260925" (VALUE=DATE) is local midnight
 */
export function parseICSDate(value) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;

  const [, y, mo, d, h = '00', mi = '00', , utc] = match;
  const year = parseInt(y, 10);
  const month = parseInt(mo, 10) - 1;
  const day = parseInt(d, 10);
  const hour = parseInt(h, 10);
  const minute = parseInt(mi, 10);

  if (utc) {
    return new Date(Date.UTC(year, month, day, hour, minute));
  }
  return fromLocalTime(year, month, day, hour, minute);
}
