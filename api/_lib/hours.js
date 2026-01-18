/**
 * Hours checking utilities
 * Determines if a place is currently open based on hours data from Google
 */

/**
 * Check if a place is currently open
 * @param {Object} hours - Hours object from Google Places API
 * @param {Date} checkTime - Time to check (defaults to now)
 * @returns {boolean} - True if open, false if closed or unknown
 */
export function isCurrentlyOpen(hours, checkTime = new Date()) {
  if (!hours || !hours.periods || hours.periods.length === 0) {
    // No hours data - assume it might be open
    return true;
  }

  // Check if 24/7
  if (hours.type === 'always_open' || hours.always_open) {
    return true;
  }

  // Get current day and time
  const day = checkTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const timeStr = checkTime.toTimeString().substring(0, 5).replace(':', ''); // "0930"
  const currentTime = parseInt(timeStr);

  // Find periods for today
  const todayPeriods = hours.periods.filter(period => {
    if (!period.open) return false;
    return period.open.day === day;
  });

  if (todayPeriods.length === 0) {
    // No periods for today = closed
    return false;
  }

  // Check if current time falls within any open period
  for (const period of todayPeriods) {
    const openTime = parseInt(period.open.time);
    const closeTime = period.close ? parseInt(period.close.time) : 2400;

    // Handle overnight hours (e.g., open until 2am)
    if (period.close && period.close.day !== day) {
      // Closes tomorrow
      if (currentTime >= openTime || currentTime < closeTime) {
        return true;
      }
    } else {
      // Same day close
      if (currentTime >= openTime && currentTime < closeTime) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get a human-readable status message
 * @param {Object} hours - Hours object
 * @param {Date} checkTime - Time to check
 * @returns {string} - Status message like "Open now" or "Closed"
 */
export function getHoursStatus(hours, checkTime = new Date()) {
  if (!hours || !hours.weekday_text) {
    return 'Hours not available';
  }

  const isOpen = isCurrentlyOpen(hours, checkTime);

  if (hours.always_open) {
    return 'Open 24 hours';
  }

  if (isOpen) {
    return 'Open now';
  } else {
    return 'Closed now';
  }
}

/**
 * Get today's hours as a readable string
 * @param {Object} hours - Hours object
 * @returns {string} - Hours for today
 */
export function getTodaysHours(hours) {
  if (!hours || !hours.weekday_text) {
    return 'Hours not available';
  }

  if (hours.always_open) {
    return 'Open 24 hours';
  }

  const today = new Date().getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  if (hours.weekday_text && hours.weekday_text.length > today) {
    const todayText = hours.weekday_text[today];
    // Extract just the hours part after the colon
    return todayText.split(': ')[1] || todayText;
  }

  return 'Hours not available';
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

/**
 * Get sunset time for Madison, WI (approximate)
 * @param {Date} date - Date to check
 * @returns {number} - Sunset time in HHMM format
 */
export function getSunsetTime(date = new Date()) {
  const month = date.getMonth(); // 0-11

  // Approximate sunset times for Madison, WI throughout the year
  const sunsetTimes = {
    0: 1630,  // January
    1: 1700,  // February
    2: 1800,  // March
    3: 1900,  // April
    4: 1945,  // May
    5: 2015,  // June
    6: 2015,  // July
    7: 1945,  // August
    8: 1845,  // September
    9: 1745,  // October
    10: 1645, // November
    11: 1615  // December
  };

  return sunsetTimes[month];
}
