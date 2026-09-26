import { describe, it, expect } from 'vitest';
import { isOpenAt, isOpenForVisit, getTodaysHours } from '../api/_lib/hours.js';
import { fromLocalTime } from '../api/_lib/time.js';

// Sep 2026: the 21st is a Monday, so the 25th is Friday, 26th Saturday, 27th Sunday
const madison = (day, hour, minute = 0) => fromLocalTime(2026, 8, day, hour, minute);

// Coffee shop: 7am-6pm every day
const cafe = {
  type: 'standard',
  periods: [0, 1, 2, 3, 4, 5, 6].map(day => ({
    open: { day, time: '0700' },
    close: { day, time: '1800' },
  })),
};

// Bar: 4pm-2am Monday through Saturday, closed Sunday
const bar = {
  type: 'standard',
  periods: [1, 2, 3, 4, 5, 6].map(day => ({
    open: { day, time: '1600' },
    close: { day: (day + 1) % 7, time: '0200' },
  })),
};

describe('isOpenAt', () => {
  it('uses Madison time, not server (UTC) time', () => {
    // 5pm Madison = 10pm UTC. A UTC clock would call the cafe closed.
    expect(isOpenAt(cafe, madison(25, 17))).toBe(true);
    // 6am Madison = 11am UTC. A UTC clock would call the cafe open.
    expect(isOpenAt(cafe, madison(25, 6))).toBe(false);
  });

  it('handles bars that close after midnight', () => {
    expect(isOpenAt(bar, madison(25, 23))).toBe(true); // Friday 11pm
    expect(isOpenAt(bar, madison(26, 1))).toBe(true);  // Saturday 1am, from Friday
    expect(isOpenAt(bar, madison(26, 3))).toBe(false); // Saturday 3am
  });

  it('handles Saturday night wrapping into Sunday when closed Sunday', () => {
    expect(isOpenAt(bar, madison(27, 1))).toBe(true);  // Sunday 1am, from Saturday
    expect(isOpenAt(bar, madison(27, 20))).toBe(false); // Sunday 8pm, closed
  });

  it('accepts Places API (New) hour/minute periods', () => {
    const hours = {
      periods: [{ open: { day: 5, hour: 9, minute: 30 }, close: { day: 5, hour: 17, minute: 0 } }],
    };
    expect(isOpenAt(hours, madison(25, 10))).toBe(true);
    expect(isOpenAt(hours, madison(25, 9))).toBe(false);
  });

  it('treats a period with no close as 24/7', () => {
    expect(isOpenAt({ periods: [{ open: { day: 0, time: '0000' } }] }, madison(25, 3))).toBe(true);
    expect(isOpenAt({ always_open: true }, madison(25, 3))).toBe(true);
  });

  it('does not hide places with missing or malformed hours', () => {
    expect(isOpenAt(null)).toBe(true);
    expect(isOpenAt({ type: 'unknown', periods: [] })).toBe(true);
    // What the old sync stored for Places API (New) data: no usable times
    const malformed = { periods: [{ open: { day: 1, hour: NaN }, close: { day: 1, hour: NaN } }] };
    expect(isOpenAt(malformed)).toBe(true);
  });
});

describe('isOpenForVisit', () => {
  it('skips places about to close', () => {
    expect(isOpenForVisit(cafe, madison(25, 17, 45), 30)).toBe(false);
    expect(isOpenForVisit(cafe, madison(25, 17, 0), 30)).toBe(true);
  });
});

describe('getTodaysHours', () => {
  const hours = {
    weekday_text: [
      'Monday: 7:00 AM – 6:00 PM',
      'Tuesday: 7:00 AM – 6:00 PM',
      'Wednesday: 7:00 AM – 6:00 PM',
      'Thursday: 7:00 AM – 6:00 PM',
      'Friday: 7:00 AM – 9:00 PM',
      'Saturday: 8:00 AM – 9:00 PM',
      'Sunday: Closed',
    ],
  };

  it("indexes Google's Monday-first weekday_text correctly", () => {
    expect(getTodaysHours(hours, madison(25, 12))).toBe('7:00 AM – 9:00 PM');
    expect(getTodaysHours(hours, madison(27, 12))).toBe('Closed');
  });

  it('returns null when unknown', () => {
    expect(getTodaysHours(null)).toBeNull();
    expect(getTodaysHours({ weekday_text: [] })).toBeNull();
  });
});

describe('getClosingTime', () => {
  it('finds when the current period ends, in Madison time', async () => {
    const { getClosingTime } = await import('../api/_lib/hours.js');
    expect(getClosingTime(cafe, madison(25, 15)).toISOString()).toBe(madison(25, 18).toISOString());
    // Friday 11pm at the bar: closes 2am Saturday
    expect(getClosingTime(bar, madison(25, 23)).toISOString()).toBe(madison(26, 2).toISOString());
    // Saturday night into Sunday wraps the week
    expect(getClosingTime(bar, madison(26, 23, 30)).toISOString()).toBe(madison(27, 2).toISOString());
    expect(getClosingTime(cafe, madison(25, 20))).toBeNull();
    expect(getClosingTime({ always_open: true })).toBeNull();
  });
});
