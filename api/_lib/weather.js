/**
 * Weather from the National Weather Service (api.weather.gov)
 *
 * Free and keyless; it only asks for a descriptive User-Agent. Forecasts
 * are cached in memory for 10 minutes per warm serverless instance, and a
 * slow or failing NWS never holds up recommendations: callers get null.
 */

import { MADISON } from './sun.js';

const USER_AGENT = 'IntentionalThingsFinder/1.0 (+https://github.com/setosa-versicolor/intentional-things-finder)';
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 2500;

let hourlyUrl = null;
let cache = { at: 0, periods: null };

export function resetWeatherCache() {
  hourlyUrl = null;
  cache = { at: 0, periods: null };
}

async function getJSON(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hourly forecast periods for Madison, or null if unavailable
 */
export async function getHourlyForecast({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache.periods && now - cache.at < CACHE_MS) return cache.periods;

  try {
    if (!hourlyUrl) {
      const point = await getJSON(`https://api.weather.gov/points/${MADISON.lat},${MADISON.lng}`, fetchImpl);
      hourlyUrl = point?.properties?.forecastHourly;
      if (!hourlyUrl) throw new Error('No forecastHourly URL for Madison');
    }
    const forecast = await getJSON(hourlyUrl, fetchImpl);
    const periods = forecast?.properties?.periods;
    if (!Array.isArray(periods)) throw new Error('Unexpected forecast format');

    cache = { at: now, periods };
    return periods;
  } catch (err) {
    console.warn('⚠️  Weather unavailable:', err.message);
    return cache.periods; // a stale forecast beats none
  }
}

/** "5 to 15 mph" -> 15 */
function parseWindMph(windSpeed) {
  const numbers = String(windSpeed || '').match(/\d+/g);
  return numbers ? Math.max(...numbers.map(Number)) : 0;
}

const SEVERE = /thunder|storm|blizzard|freezing|sleet|ice|hail|tornado|heavy/i;
const WET = /rain|showers|drizzle|snow|flurries/i;

/**
 * Rate conditions for being outside: 'great' | 'ok' | 'meh' | 'bad'
 */
export function rateConditions({ temperature, precipChance, windMph, shortForecast }) {
  const text = shortForecast || '';
  if (SEVERE.test(text) || precipChance >= 60 || temperature < 15 || temperature >= 93 || windMph >= 25) {
    return 'bad';
  }
  if (WET.test(text) || precipChance >= 30 || temperature < 35 || temperature > 86 || windMph >= 18) {
    return 'meh';
  }
  if (precipChance < 20 && temperature >= 60 && temperature <= 82 && windMph < 15) {
    return 'great';
  }
  return 'ok';
}

/**
 * The forecast for the hour containing `date`, summarized, or null
 */
export function weatherAt(periods, date) {
  if (!Array.isArray(periods)) return null;
  const t = date.getTime();
  const period = periods.find(p => new Date(p.startTime).getTime() <= t && t < new Date(p.endTime).getTime());
  if (!period) return null;

  const temperature = period.temperatureUnit === 'C'
    ? Math.round(period.temperature * 9 / 5 + 32)
    : period.temperature;
  const summary = {
    temperature,
    shortForecast: period.shortForecast || '',
    precipChance: period.probabilityOfPrecipitation?.value ?? 0,
    windMph: parseWindMph(period.windSpeed),
    isDaytime: Boolean(period.isDaytime),
  };
  return { ...summary, rating: rateConditions(summary) };
}
