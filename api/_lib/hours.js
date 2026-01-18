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
