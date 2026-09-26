import { describe, it, expect } from 'vitest';
import { preferencesForMood, minutesFor, startOptions, MOODS } from '../src/moods.js';
import { createHistory, SOMEDAY_LIMIT } from '../src/history.js';
import { fromLocalTime, getLocalParts } from '../api/_lib/time.js';
import { VOCABULARY } from '../api/_lib/tags.js';

describe('moods', () => {
  it('only use tags the ranking knows', () => {
    for (const mood of MOODS) {
      for (const tag of mood.prefs?.tags || []) expect(VOCABULARY).toContain(tag);
    }
  });

  it('maps a mood onto preferences, and "surprise me" rolls new vibes', () => {
    expect(preferencesForMood('rainy')).toMatchObject({ location: 'inside', tags: [] });
    expect(preferencesForMood('surprise', () => 0.9)).toMatchObject({ quietToLively: 0.9, activeToRelaxing: 0.9 });
    expect(preferencesForMood('nope')).toMatchObject({ quietToLively: 0.5 });
  });
});

describe('time dial', () => {
  it('turns "the evening" into minutes until 11pm, at least two hours', () => {
    expect(minutesFor('evening', fromLocalTime(2026, 8, 26, 18, 0))).toBe(300);
    expect(minutesFor('evening', fromLocalTime(2026, 8, 26, 22, 30))).toBe(120);
    expect(minutesFor('1h')).toBe(60);
  });

  it('offers tonight only before 5pm, and Saturday only when it is a few days off', () => {
    const wednesdayNoon = fromLocalTime(2026, 8, 23, 12, 0);
    const ids = startOptions(wednesdayNoon).map(o => o.id);
    expect(ids).toEqual(['now', 'tonight', 'tomorrow', 'saturday']);
    const saturday = startOptions(wednesdayNoon).find(o => o.id === 'saturday').date;
    expect(getLocalParts(saturday)).toMatchObject({ weekday: 6, hour: 10, day: 26 });

    const fridayEvening = fromLocalTime(2026, 8, 25, 19, 0);
    expect(startOptions(fridayEvening).map(o => o.id)).toEqual(['now', 'tomorrow']);
  });
});

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('device history', () => {
  const card = (n) => ({ key: `place-${n}`, title: `Place ${n}`, mapUrl: 'https://maps' });

  it('asks "did you go?" a few hours after tapping Go, once', () => {
    const history = createHistory(memoryStorage());
    const tapped = new Date('2026-09-26T15:00:00Z');
    history.recordGo(card(1), tapped);

    expect(history.pendingQuestion(new Date('2026-09-26T16:00:00Z'))).toBeNull();
    const later = new Date('2026-09-26T20:00:00Z');
    expect(history.pendingQuestion(later)).toMatchObject({ key: 'place-1' });

    history.recordVerdict('place-1', 'meh');
    expect(history.pendingQuestion(later)).toBeNull();
    expect(history.rankingHints().disliked).toEqual(['place-1']);
  });

  it('remembers the last few sessions as recently seen', () => {
    const history = createHistory(memoryStorage());
    history.recordShown(['place-1', 'place-2']);
    history.recordShown(['place-3']);
    expect(history.rankingHints().recent.sort()).toEqual(['place-1', 'place-2', 'place-3']);
  });

  it(`caps Someday at ${SOMEDAY_LIMIT}, and a second tap removes`, () => {
    const history = createHistory(memoryStorage());
    for (let i = 0; i < SOMEDAY_LIMIT; i++) expect(history.toggleSomeday(card(i))).toBe(true);
    expect(history.toggleSomeday(card(99))).toBe(false);
    history.toggleSomeday(card(0));
    expect(history.load().someday).toHaveLength(SOMEDAY_LIMIT - 1);
  });

  it('keeps working when storage throws', () => {
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const history = createHistory(broken);
    history.recordShown(['place-1']);
    expect(history.rankingHints()).toEqual({ recent: [], disliked: [] });
  });
});
