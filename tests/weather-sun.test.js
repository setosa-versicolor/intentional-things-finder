import { describe, it, expect, beforeEach } from 'vitest';
import { getHourlyForecast, weatherAt, rateConditions, resetWeatherCache } from '../api/_lib/weather.js';
import { getSunTimes, isDark, isGoldenHour } from '../api/_lib/sun.js';
import { buildContext, conditionsScore, rankActivities } from '../api/_lib/recommend.js';
import { fromLocalTime } from '../api/_lib/time.js';

// Shaped like api.weather.gov responses
const POINT = { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/MKX/37,64/forecast/hourly' } };
const period = (start, overrides = {}) => ({
  startTime: start.toISOString(),
  endTime: new Date(start.getTime() + 3600000).toISOString(),
  isDaytime: true,
  temperature: 68,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 5 },
  windSpeed: '5 to 10 mph',
  shortForecast: 'Mostly Sunny',
  ...overrides,
});

const fri6pm = fromLocalTime(2026, 8, 25, 18, 0);

describe('getHourlyForecast', () => {
  beforeEach(() => resetWeatherCache());

  it('follows the points lookup to the hourly forecast and caches it', async () => {
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(url);
      const body = url.includes('/points/') ? POINT : { properties: { periods: [period(fri6pm)] } };
      return { ok: true, json: async () => body };
    };

    const periods = await getHourlyForecast({ fetchImpl: fakeFetch, now: 0 });
    expect(periods).toHaveLength(1);
    expect(calls[0]).toContain('/points/43.0747,-89.3842');
    expect(calls[1]).toBe(POINT.properties.forecastHourly);

    await getHourlyForecast({ fetchImpl: fakeFetch, now: 60000 });
    expect(calls).toHaveLength(2); // served from cache
  });

  it('returns null instead of throwing when NWS is down', async () => {
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect(await getHourlyForecast({ fetchImpl: down, now: 0 })).toBeNull();
  });
});

describe('weatherAt', () => {
  it('summarizes the hour containing the requested time', () => {
    const periods = [period(fri6pm), period(new Date(fri6pm.getTime() + 3600000), { shortForecast: 'Rain', probabilityOfPrecipitation: { value: 80 } })];
    expect(weatherAt(periods, new Date(fri6pm.getTime() + 30 * 60000))).toMatchObject({
      temperature: 68, windMph: 10, precipChance: 5, rating: 'great',
    });
    expect(weatherAt(periods, new Date(fri6pm.getTime() + 90 * 60000)).rating).toBe('bad');
    expect(weatherAt(periods, new Date(fri6pm.getTime() + 5 * 3600000))).toBeNull();
    expect(weatherAt(null, fri6pm)).toBeNull();
  });

  it('rates conditions for being outside', () => {
    expect(rateConditions({ temperature: 72, precipChance: 0, windMph: 5, shortForecast: 'Sunny' })).toBe('great');
    expect(rateConditions({ temperature: 50, precipChance: 10, windMph: 5, shortForecast: 'Cloudy' })).toBe('ok');
    expect(rateConditions({ temperature: 70, precipChance: 40, windMph: 5, shortForecast: 'Chance Showers' })).toBe('meh');
    expect(rateConditions({ temperature: 75, precipChance: 20, windMph: 5, shortForecast: 'Slight Chance Thunderstorms' })).toBe('bad');
    expect(rateConditions({ temperature: 5, precipChance: 0, windMph: 5, shortForecast: 'Sunny' })).toBe('bad');
  });
});

describe('sun', () => {
  it('knows when the sun sets in Madison', () => {
    const { sunset } = getSunTimes(fri6pm);
    // About 6:49pm CDT on Sep 25
    expect(Math.abs(sunset.getTime() - fromLocalTime(2026, 8, 25, 18, 49).getTime())).toBeLessThan(5 * 60000);
  });

  it('stays on the same Madison day late at night', () => {
    const lateNight = fromLocalTime(2026, 8, 25, 23, 30);
    expect(getSunTimes(lateNight).sunset.getTime()).toBe(getSunTimes(fri6pm).sunset.getTime());
    expect(isDark(lateNight)).toBe(true);
  });

  it('spots golden hour', () => {
    expect(isGoldenHour(fromLocalTime(2026, 8, 25, 18, 20))).toBe(true);
    expect(isGoldenHour(fromLocalTime(2026, 8, 25, 14, 0))).toBe(false);
  });
});

describe('conditions in ranking', () => {
  const park = { type: 'place', id: 1, title: 'Picnic Point', vibe_inside: '0.10', tags: ['nature'], vibe_quiet: '0.5', vibe_active: '0.5' };
  const museum = { type: 'place', id: 2, title: 'Chazen', vibe_inside: '0.95', tags: ['educational'], vibe_quiet: '0.5', vibe_active: '0.5' };
  const sledding = { type: 'place', id: 3, title: 'Elver Hill', vibe_inside: '0.0', tags: ['sledding'], seasons: ['winter'] };
  const prefs = { timeAvailable: 120, quietToLively: 0.5, activeToRelaxing: 0.5, location: 'either', tags: [] };
  const noon = fromLocalTime(2026, 8, 25, 12, 0);
  const summary = (overrides) => ({ temperature: 70, precipChance: 0, windMph: 5, shortForecast: 'Sunny', rating: 'great', ...overrides });

  it('sends people indoors in a thunderstorm', () => {
    const ctx = buildContext({ date: noon, random: () => 0, weather: summary({ shortForecast: 'Thunderstorms', rating: 'bad' }) });
    expect(rankActivities([park, museum], prefs, ctx, 1)[0].title).toBe('Chazen');
  });

  it('sends people outside on a perfect afternoon', () => {
    const ctx = buildContext({ date: noon, random: () => 0, weather: summary() });
    expect(rankActivities([park, museum], prefs, ctx, 1)[0].title).toBe('Picnic Point');
  });

  it('does not send people down unlit trails after dark', () => {
    const ctx = buildContext({ date: fromLocalTime(2026, 8, 25, 22, 0), random: () => 0 });
    expect(conditionsScore(park, ctx)).toBe(-20);
    expect(conditionsScore(museum, ctx)).toBe(0);
  });

  it('does not penalize winter activities for winter weather', () => {
    const jan = fromLocalTime(2026, 0, 14, 12, 0);
    const snowy = buildContext({ date: jan, weather: summary({ temperature: 22, shortForecast: 'Light Snow', precipChance: 50, rating: 'meh' }) });
    expect(conditionsScore(sledding, snowy)).toBe(0);
    expect(conditionsScore(park, snowy)).toBe(-10);
  });

  it('changes nothing when weather is unknown', () => {
    const ctx = buildContext({ date: noon });
    expect(conditionsScore(park, ctx)).toBe(0);
  });
});
