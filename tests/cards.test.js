import { describe, it, expect } from 'vitest';
import { toCard, buildMapUrl, describeEventTime, greetingFor } from '../src/cards.js';
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
