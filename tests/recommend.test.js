import { describe, it, expect } from 'vitest';
import {
  buildContext,
  rankActivities,
  eventInWindow,
  isEligible,
} from '../api/_lib/recommend.js';
import { fromLocalTime } from '../api/_lib/time.js';
import { FALLBACK_PLACES } from '../src/fallbackPlaces.js';

const noRandom = () => 0;
const baseline = {
  timeAvailable: 120,
  quietToLively: 0.5,
  activeToRelaxing: 0.5,
  location: 'either',
  tags: [],
};

const place = (overrides) => ({
  type: 'place',
  id: 1,
  title: 'Somewhere',
  vibe_quiet: '0.50', // pg returns DECIMAL as strings
  vibe_inside: '0.50',
  vibe_active: '0.50',
  tags: [],
  best_times: [],
  walk_minutes_from_center: 10,
  hours: null,
  seasons: null,
  ...overrides,
});

const julyEvening = fromLocalTime(2026, 6, 10, 18, 0);
const januaryEvening = fromLocalTime(2026, 0, 14, 18, 0);

describe('vibe scoring', () => {
  it('prefers quiet places when the slider is on quiet', () => {
    const quiet = place({ id: 1, title: 'Picnic Point', vibe_quiet: '0.90' });
    const loud = place({ id: 2, title: 'Busy Bar', vibe_quiet: '0.20' });
    const ctx = buildContext({ date: julyEvening, random: noRandom });

    const [top] = rankActivities([loud, quiet], { ...baseline, quietToLively: 0 }, ctx, 1);
    expect(top.title).toBe('Picnic Point');

    const [lively] = rankActivities([loud, quiet], { ...baseline, quietToLively: 1 }, ctx, 1);
    expect(lively.title).toBe('Busy Bar');
  });

  it('prefers active places when the slider is on active', () => {
    const calm = place({ id: 1, title: 'Bookstore', vibe_active: '0.10' });
    const active = place({ id: 2, title: 'Bike Trail', vibe_active: '0.90' });
    const ctx = buildContext({ date: julyEvening, random: noRandom });

    const [top] = rankActivities([calm, active], { ...baseline, activeToRelaxing: 1 }, ctx, 1);
    expect(top.title).toBe('Bike Trail');
  });

  it('rewards the right time of day in Madison', () => {
    const morning = place({ id: 1, title: 'Morning Cafe', best_times: ['morning'] });
    const evening = place({ id: 2, title: 'Evening Spot', best_times: ['evening'] });
    const ctx = buildContext({ date: julyEvening, random: noRandom });
    const [top] = rankActivities([morning, evening], baseline, ctx, 1);
    expect(top.title).toBe('Evening Spot');
  });
});

describe('hard filters', () => {
  it('drops out-of-season places', () => {
    const sledding = place({ title: 'Sledding Hill', seasons: ['winter'] });
    expect(isEligible(sledding, baseline, buildContext({ date: julyEvening }))).toBe(false);
    expect(isEligible(sledding, baseline, buildContext({ date: januaryEvening }))).toBe(true);
  });

  it('drops places that are closed at the requested time', () => {
    const morningOnly = place({
      hours: { periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, time: '0700' }, close: { day, time: '1400' } })) },
    });
    expect(isEligible(morningOnly, baseline, buildContext({ date: julyEvening }))).toBe(false);
    expect(isEligible(morningOnly, baseline, buildContext({ date: fromLocalTime(2026, 6, 10, 9, 0) }))).toBe(true);
  });

  it('respects inside/outside', () => {
    const park = place({ vibe_inside: '0.10' });
    const ctx = buildContext({ date: julyEvening });
    expect(isEligible(park, { ...baseline, location: 'inside' }, ctx)).toBe(false);
    expect(isEligible(park, { ...baseline, location: 'outside' }, ctx)).toBe(true);
  });

  it('drops places too far for the time available', () => {
    const far = place({ walk_minutes_from_center: 40 });
    const ctx = buildContext({ date: julyEvening });
    expect(isEligible(far, { ...baseline, timeAvailable: 60 }, ctx)).toBe(false);
    expect(isEligible(far, { ...baseline, timeAvailable: 120 }, ctx)).toBe(true);
  });
});

describe('events', () => {
  const at = (hours) => new Date(julyEvening.getTime() + hours * 60 * 60 * 1000).toISOString();

  it('includes events starting within the window', () => {
    expect(eventInWindow({ start_time: at(1) }, julyEvening, 120)).toBe(true);
  });

  it('excludes events far in the future', () => {
    expect(eventInWindow({ start_time: at(24 * 5) }, julyEvening, 120)).toBe(false);
  });

  it('excludes events starting too late to enjoy', () => {
    expect(eventInWindow({ start_time: at(1.9) }, julyEvening, 120)).toBe(false);
  });

  it('includes events already running with time left', () => {
    expect(eventInWindow({ start_time: at(-1), end_time: at(2) }, julyEvening, 60)).toBe(true);
    expect(eventInWindow({ start_time: at(-1), end_time: at(0.1) }, julyEvening, 60)).toBe(false);
  });
});

describe('offline fallback', () => {
  it('returns suggestions with the preferences the form actually sends', () => {
    const ctx = buildContext({ date: fromLocalTime(2026, 6, 11, 10, 0) });
    const results = rankActivities(FALLBACK_PLACES, baseline, ctx, 3);
    expect(results).toHaveLength(3);
    results.forEach(r => expect(Number.isFinite(r.score)).toBe(true));
  });
});
