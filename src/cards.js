/**
 * Turn API / fallback activities into what a card needs to show
 */

import { CITY_TIMEZONE, getLocalParts, getTimeOfDay } from '../api/_lib/time.js';

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
 * "Today: 7:00 AM – 6:00 PM" or "Saturday: 7:00 AM – 6:00 PM"
 */
export function describeHours(hoursToday, requestedDate = new Date(), now = new Date()) {
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

/**
 * Normalize an activity row into card props
 */
export function toCard(activity, { requestedDate = new Date(), now = new Date() } = {}) {
  const isEvent = activity.type === 'event';
  const walk = toNumber(activity.walk_minutes_from_center);

  return {
    key: `${activity.type}-${activity.id}`,
    id: activity.id,
    type: activity.type,
    label: isEvent ? 'event' : (activity.category || 'place'),
    title: activity.title,
    neighborhood: isEvent ? (activity.venue_name || activity.neighborhood) : activity.neighborhood,
    story: activity.description || null,
    nudge: activity.nudge || null,
    walkMinutes: isEvent ? null : walk,
    when: isEvent
      ? describeEventTime(activity.start_time, activity.end_time, now)
      : describeHours(activity.hours_today, requestedDate, now),
    mapUrl: buildMapUrl(activity),
    detailsUrl: isEvent ? (activity.source_url || null) : null,
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
