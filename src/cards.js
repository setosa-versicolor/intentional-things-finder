/**
 * Turn API / fallback activities into what a card needs to show
 */

import { CITY_TIMEZONE, getLocalParts, getTimeOfDay } from '../api/_lib/time.js';
import { getClosingTime } from '../api/_lib/hours.js';

const SOON_MS = 3 * 60 * 60 * 1000;

const toNumber = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CITY_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CITY_TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CITY_TIMEZONE,
  weekday: 'long',
});

export function isSameMadisonDay(a, b) {
  const pa = getLocalParts(a);
  const pb = getLocalParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/**
 * "Starts in 40 min", "Happening now · until 9:00 PM", or "Sat, Sep 27, 7:30 PM"
 */
export function describeEventTime(startTime, endTime, now = new Date()) {
  if (!startTime) return null;
  const start = new Date(startTime);
  const diff = start.getTime() - now.getTime();

  if (diff <= 0) {
    return endTime
      ? `Happening now · until ${timeFormatter.format(new Date(endTime))}`
      : 'Happening now';
  }

  if (diff <= SOON_MS) {
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `Starts in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `Starts in ${hours} hr${rest ? ` ${rest} min` : ''}`;
  }

  return dateTimeFormatter.format(start);
}

/**
 * "Open until 9:00 PM", "Open 24 hours", or else today's posted hours
 * ("Today: 7:00 AM – 6:00 PM", "Saturday: 7:00 AM – 6:00 PM")
 */
export function describeHours(hoursToday, requestedDate = new Date(), now = new Date(), hours = null) {
  if (hours?.always_open) return 'Open 24 hours';

  const closesAt = getClosingTime(hours, requestedDate);
  if (closesAt) {
    const day = isSameMadisonDay(requestedDate, now) ? '' : `${weekdayFormatter.format(requestedDate)}: `;
    return `${day}Open until ${timeFormatter.format(closesAt)}`;
  }

  if (!hoursToday) return null;
  const day = isSameMadisonDay(requestedDate, now) ? 'Today' : weekdayFormatter.format(requestedDate);
  return `${day}: ${hoursToday}`;
}

export function buildMapUrl(activity) {
  const base = 'https://www.google.com/maps/search/?api=1';
  const title = activity.title || '';

  if (activity.google_place_id) {
    return `${base}&query=${encodeURIComponent(title)}&query_place_id=${encodeURIComponent(activity.google_place_id)}`;
  }

  const lat = toNumber(activity.lat);
  const lng = toNumber(activity.lng);
  if (lat !== null && lng !== null) {
    return `${base}&query=${lat},${lng}`;
  }

  const query = activity.venue_address || activity.venue_name || `${title} Madison WI`;
  return `${base}&query=${encodeURIComponent(query)}`;
}

export const ROLE_LABELS = {
  'sure-thing': 'Sure thing',
  'something-different': 'Something different',
  'wildcard': 'Wildcard',
};

const TRAVEL_WORDS = { walk: 'walk', bike: 'by bike', drive: 'drive' };

/** "12 min walk", "9 min by bike", or the old walk from the Square */
export function describeTravel(activity) {
  if (activity.travel) return `${activity.travel.minutes} min ${TRAVEL_WORDS[activity.travel.mode]}`;
  const walk = activity.type === 'place' ? toNumber(activity.walk_minutes_from_center) : null;
  return walk !== null ? `${walk} min walk from the Square` : null;
}

const SUNSET_CHIP_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Small live facts worth a glance: sunset for outdoor picks, rain risk, free
 */
export function liveChips(activity, conditions, requestedDate = new Date()) {
  const chips = [];
  const outdoor = toNumber(activity.vibe_inside) !== null && toNumber(activity.vibe_inside) <= 0.4;

  if (outdoor && conditions?.sunset) {
    const sunset = new Date(conditions.sunset);
    const ahead = sunset - requestedDate;
    if (ahead > 0 && ahead <= SUNSET_CHIP_WINDOW_MS) chips.push(`Sunset ${timeFormatter.format(sunset)}`);
  }
  if (outdoor && conditions?.weather?.precipChance >= 50) {
    chips.push(`${conditions.weather.precipChance}% chance of rain`);
  }
  if (Array.isArray(activity.tags) && activity.tags.includes('free')) chips.push('Free');
  return chips;
}

/**
 * Normalize an activity row into card props
 */
export function toCard(activity, { requestedDate = new Date(), now = new Date(), conditions = null } = {}) {
  const isEvent = activity.type === 'event';
  const when = isEvent
    ? describeEventTime(activity.start_time, activity.end_time, now)
    : describeHours(activity.hours_today, requestedDate, now, activity.hours);
  const travel = describeTravel(activity);
  const mapUrl = buildMapUrl(activity);

  return {
    key: `${activity.type}-${activity.id}`,
    id: activity.id,
    type: activity.type,
    role: activity.role || null,
    roleLabel: ROLE_LABELS[activity.role] || null,
    category: activity.category || (isEvent ? 'event' : 'place'),
    label: isEvent ? 'event' : (activity.category || 'place'),
    title: activity.title,
    neighborhood: isEvent ? (activity.venue_name || activity.neighborhood) : activity.neighborhood,
    story: activity.description || null,
    nudge: activity.nudge || null,
    walkMinutes: isEvent ? null : toNumber(activity.walk_minutes_from_center),
    when,
    travel,
    status: [when, travel].filter(Boolean).join(' · '),
    chips: liveChips(activity, conditions, requestedDate),
    mapUrl,
    detailsUrl: isEvent ? (activity.source_url || null) : null,
    shareText: [activity.title, when, activity.nudge].filter(Boolean).join(' · '),
  };
}

/**
 * "Good morning", "This evening", or "Saturday afternoon"
 */
export function greetingFor(requestedDate = new Date(), now = new Date()) {
  const timeOfDay = getTimeOfDay(requestedDate);
  if (isSameMadisonDay(requestedDate, now)) {
    return {
      morning: 'Good morning',
      afternoon: 'This afternoon',
      evening: 'This evening',
    }[timeOfDay];
  }
  return `${weekdayFormatter.format(requestedDate)} ${timeOfDay}`;
}

/**
 * "68° and mostly sunny · sunset 6:49 PM"
 * Sunset is only mentioned while it's still ahead of the requested time.
 */
export function describeConditions(conditions, requestedDate = new Date()) {
  if (!conditions) return null;
  const parts = [];

  const weather = conditions.weather;
  if (weather && Number.isFinite(weather.temperature)) {
    const sky = weather.shortForecast ? ` and ${weather.shortForecast.toLowerCase()}` : '';
    parts.push(`${Math.round(weather.temperature)}°${sky}`);
  }

  if (conditions.sunset) {
    const sunset = new Date(conditions.sunset);
    if (sunset > requestedDate) parts.push(`sunset ${timeFormatter.format(sunset)}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
