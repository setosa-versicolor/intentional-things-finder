import { describe, it, expect } from 'vitest';
import { toCard, buildMapUrl, describeEventTime, greetingFor, liveChips } from '../src/cards.js';
import { fromLocalTime } from '../api/_lib/time.js';

const now = fromLocalTime(2026, 8, 25, 18, 0); // Friday 6pm in Madison

describe('toCard', () => {
  it('renders events without place-only fields', () => {
    const card = toCard({
      type: 'event',
      id: 7,
      title: 'Jazz on the Terrace',
      description: 'Live jazz.',
      nudge: null,
      walk_minutes_from_center: null,
      start_time: new Date(now.getTime() + 40 * 60000).toISOString(),
      source_url: 'https://isthmus.com/e/7',
    }, { requestedDate: now, now });

    expect(card.label).toBe('event');
    expect(card.walkMinutes).toBeNull();
    expect(card.nudge).toBeNull();
    expect(card.when).toBe('Starts in 40 min');
    expect(card.detailsUrl).toBe('https://isthmus.com/e/7');
  });

  it('labels places by category and shows today\'s hours', () => {
    const card = toCard({
      type: 'place',
      id: 3,
      title: "Bradbury's Coffee",
      category: 'café',
      walk_minutes_from_center: 12,
      hours_today: '7:00 AM – 6:00 PM',
    }, { requestedDate: now, now });

    expect(card.label).toBe('café');
    expect(card.walkMinutes).toBe(12);
    expect(card.when).toBe('Today: 7:00 AM – 6:00 PM');
  });

  it('names the day for future plans', () => {
    const saturday = fromLocalTime(2026, 8, 26, 10, 0);
    const card = toCard({ type: 'place', id: 1, title: 'X', hours_today: '8 AM – 5 PM' }, { requestedDate: saturday, now });
    expect(card.when).toBe('Saturday: 8 AM – 5 PM');
  });
});

describe('buildMapUrl', () => {
  it('prefers Google place IDs', () => {
    expect(buildMapUrl({ title: 'Olbrich', google_place_id: 'abc' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Olbrich&query_place_id=abc');
  });

  it('falls back to coordinates, then the venue, then the name', () => {
    expect(buildMapUrl({ title: 'X', lat: '43.07', lng: '-89.38' })).toContain('query=43.07,-89.38');
    expect(buildMapUrl({ title: 'X', lat: null, lng: null, venue_address: '1 Main St' })).toContain('query=1%20Main%20St');
    expect(buildMapUrl({ title: 'Show' })).toContain('query=Show%20Madison%20WI');
  });
});

describe('describeEventTime', () => {
  it('describes running and far-off events', () => {
    const end = new Date(now.getTime() + 3 * 3600000).toISOString();
    expect(describeEventTime(new Date(now.getTime() - 60000).toISOString(), end, now))
      .toBe('Happening now · until 9:00 PM');
    expect(describeEventTime(fromLocalTime(2026, 8, 27, 19, 30).toISOString(), null, now))
      .toBe('Sun, Sep 27, 7:30 PM');
  });
});

describe('greetingFor', () => {
  it('greets by Madison time of day, or names the day', () => {
    expect(greetingFor(now, now)).toBe('This evening');
    expect(greetingFor(fromLocalTime(2026, 8, 26, 14, 0), now)).toBe('Saturday afternoon');
  });
});

describe('describeConditions', () => {
  it('reads like a sentence', async () => {
    const { describeConditions } = await import('../src/cards.js');
    const sunset = fromLocalTime(2026, 8, 25, 18, 49).toISOString();
    expect(describeConditions({ weather: { temperature: 68.4, shortForecast: 'Mostly Sunny' }, sunset }, now))
      .toBe('68° and mostly sunny · sunset 6:49 PM');
    // After sunset, don't mention it
    expect(describeConditions({ weather: null, sunset }, fromLocalTime(2026, 8, 25, 20, 0))).toBeNull();
  });
});

describe('open until', () => {
  const daily = (open, close) => ({
    periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, time: open }, close: { day: close <= open ? (day + 1) % 7 : day, time: close } })),
  });

  it('prefers "Open until" over posted hours', () => {
    const card = toCard({ type: 'place', id: 1, title: 'Bar', hours: daily('1600', '0200'), hours_today: '4 PM – 2 AM' }, { requestedDate: now, now });
    expect(card.when).toBe('Open until 2:00 AM');
  });

  it('names the day for future plans and handles 24/7', () => {
    const sat = fromLocalTime(2026, 8, 26, 10, 0);
    expect(toCard({ type: 'place', id: 1, title: 'Cafe', hours: daily('0700', '1800') }, { requestedDate: sat, now }).when)
      .toBe('Saturday: Open until 6:00 PM');
    expect(toCard({ type: 'place', id: 2, title: 'Park', hours: { always_open: true } }, { requestedDate: now, now }).when)
      .toBe('Open 24 hours');
  });
});

describe('Phase 2 card details', () => {
  const base = { type: 'place', id: 5, title: 'Picnic Point', category: 'park', vibe_inside: '0.10', tags: ['nature', 'free'], hours: null };
  const noon = new Date('2026-09-26T17:00:00Z');

  it('labels the role and says how to get there from you', () => {
    const card = toCard({ ...base, role: 'wildcard', travel: { mode: 'bike', minutes: 9 } }, { requestedDate: noon, now: noon });
    expect(card).toMatchObject({ roleLabel: 'Wildcard', travel: '9 min by bike', category: 'park' });
    expect(card.status).toContain('9 min by bike');
  });

  it('shows sunset only for outdoor picks within a few hours of it, plus free', () => {
    const conditions = { sunset: '2026-09-26T23:47:00Z', weather: { precipChance: 60 } };
    const afternoon = new Date('2026-09-26T21:30:00Z');
    expect(liveChips(base, conditions, afternoon)).toEqual(['Sunset 6:47 PM', '60% chance of rain', 'Free']);
    expect(liveChips(base, conditions, noon)).toEqual(['60% chance of rain', 'Free']);
    expect(liveChips({ ...base, vibe_inside: '0.90', tags: [] }, conditions, afternoon)).toEqual([]);
  });
});
