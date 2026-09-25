/**
 * Sunrise, sunset and twilight for Madison
 */

import { getTimes } from 'suncalc';
import { getLocalParts, fromLocalTime } from './time.js';

export const MADISON = { lat: 43.0747, lng: -89.3842 }; // Capitol Square

/**
 * Sun times for the Madison calendar day containing `date`
 * @returns {{dawn: Date, sunrise: Date, goldenHour: Date, sunset: Date, dusk: Date}}
 */
export function getSunTimes(date = new Date()) {
  const { year, month, day } = getLocalParts(date);
  // Ask for local noon so late-evening requests don't roll into tomorrow's sun
  const noon = fromLocalTime(year, month, day, 12, 0);
  const t = getTimes(noon, MADISON.lat, MADISON.lng);
  return {
    dawn: t.dawn,
    sunrise: t.sunrise,
    goldenHour: t.goldenHour,
    sunset: t.sunset,
    dusk: t.dusk,
  };
}

/** Too dark to enjoy an unlit outdoor spot */
export function isDark(date, sun = getSunTimes(date)) {
  return date < sun.dawn || date >= sun.dusk;
}

/** The hour or so of warm light before sunset */
export function isGoldenHour(date, sun = getSunTimes(date)) {
  const start = new Date(Math.min(sun.goldenHour.getTime(), sun.sunset.getTime() - 60 * 60 * 1000));
  return date >= start && date < sun.sunset;
}
