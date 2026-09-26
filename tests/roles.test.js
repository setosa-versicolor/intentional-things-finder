import { describe, it, expect } from 'vitest';
import {
  buildContext,
  recommend,
  pickWithRoles,
  travelFrom,
  fitsTimeBudget,
  isEligible,
} from '../api/_lib/recommend.js';
import { fromLocalTime } from '../api/_lib/time.js';

const noRandom = () => 0;
const baseline = { timeAvailable: 120, quietToLively: 0.5, activeToRelaxing: 0.5, location: 'either', tags: [] };
const ctx = buildContext({ date: fromLocalTime(2026, 6, 10, 14, 0), random: noRandom });

let nextId = 1;
const place = (overrides) => ({
  type: 'place', id: nextId++, title: 'Somewhere', category: 'cafe', neighborhood: 'Marquette',
  vibe_quiet: '0.50', vibe_inside: '0.50', vibe_active: '0.50',
  tags: [], best_times: [], walk_minutes_from_center: 10, hours: null, seasons: null,
  lat: 43.0747, lng: -89.3841,
  ...overrides,
});

// Scored stand-ins, best first
const scored = (list) => list.map((a, i) => ({ ...a, score: 100 - i }));

describe('pickWithRoles', () => {
  it('gives three different kinds of thing instead of three cafés', () => {
    const ranked = scored([
      place({ title: 'Cafe A' }),
      place({ title: 'Cafe B' }),
      place({ title: 'Cafe C' }),
      place({ title: 'Park', category: 'park', neighborhood: 'Tenney-Lapham' }),
      place({ title: 'Bookstore', category: 'bookstore' }),
    ]);
    const picks = pickWithRoles(ranked);
    expect(picks.map(p => p.title)).toEqual(['Cafe A', 'Park', 'Bookstore']);
    expect(picks.map(p => p.role)).toEqual(['sure-thing', 'something-different', 'wildcard']);
  });

  it('lets an event or off-the-beaten-path pick win the wildcard slot over a slightly better match', () => {
    const ranked = scored([
      place({ title: 'Cafe' }),
      place({ title: 'Park', category: 'park' }),
      place({ title: 'Museum', category: 'museum' }),
      place({ title: 'Bar', category: 'bar' }),
      { ...place({ title: 'Concert' }), type: 'event' },
    ]);
    expect(pickWithRoles(ranked)[2].title).toBe('Concert');
  });

  it('falls back to the next best when there is no variety', () => {
    const ranked = scored([place({ title: 'A' }), place({ title: 'B' }), place({ title: 'C' })]);
    expect(pickWithRoles(ranked).map(p => p.title)).toEqual(['A', 'B', 'C']);
  });

  it('fills one slot during a swap, avoiding kinds already on screen', () => {
    const ranked = scored([place({ title: 'Cafe' }), place({ title: 'Park', category: 'park' })]);
    const [pick] = pickWithRoles(ranked, { count: 1, role: 'something-different', avoidCategories: ['cafe'] });
    expect(pick).toMatchObject({ title: 'Park', role: 'something-different' });
  });
});

describe('travel from where you are', () => {
  const capitol = { lat: 43.0747, lng: -89.3841 };

  it('walks when close, bikes a bit further, drives when far', () => {
    expect(travelFrom(capitol, place({ lat: 43.0731, lng: -89.3890 }))).toMatchObject({ mode: 'walk' }); // Overture Center
    expect(travelFrom(capitol, place({ lat: 43.0766, lng: -89.4125 }))).toMatchObject({ mode: 'bike' }); // Memorial Union
    expect(travelFrom(capitol, place({ lat: 43.0936, lng: -89.3431 }))).toMatchObject({ mode: 'bike' }); // Olbrich
    expect(travelFrom(capitol, place({ lat: 43.0431, lng: -89.5046 }))).toMatchObject({ mode: 'drive' }); // Elver Park
    expect(travelFrom(null, place({}))).toBeNull();
  });

  it('uses distance from you, not from the Capitol, for the time budget', () => {
    const farFromSquare = place({ walk_minutes_from_center: 50, lat: 43.0431, lng: -89.5046 });
    const nearby = { lat: 43.0450, lng: -89.5020 };
    expect(fitsTimeBudget(farFromSquare, 60)).toBe(false);
    expect(fitsTimeBudget(farFromSquare, 60, nearby)).toBe(true);
  });
});

describe('history and swaps', () => {
  it('never shows excluded cards again', () => {
    const a = place({ title: 'Swapped away' });
    expect(isEligible(a, { ...baseline, exclude: [`place-${a.id}`] }, ctx)).toBe(false);
  });

  it('downranks places seen lately and places you did not enjoy', () => {
    const seen = place({ title: 'Seen', category: 'a' });
    const meh = place({ title: 'Meh', category: 'b' });
    const fresh = place({ title: 'Fresh', category: 'c' });
    const picks = recommend([seen, meh, fresh], {
      ...baseline, recent: [`place-${seen.id}`], disliked: [`place-${meh.id}`],
    }, ctx);
    expect(picks.map(p => p.title)).toEqual(['Fresh', 'Seen', 'Meh']);
  });

  it('adds travel details to each pick when we know where you are', () => {
    const [pick] = recommend([place({})], { ...baseline, origin: { lat: 43.0747, lng: -89.3841 } }, ctx);
    expect(pick.travel).toEqual({ mode: 'walk', minutes: 1 });
    expect(pick.category).toBe('cafe');
  });
});
