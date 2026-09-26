import { describe, it, expect } from 'vitest';
import { getTimeOfDay, getSeason, getLocalParts, parseICSDate, fromLocalTime } from '../api/_lib/time.js';

describe('Madison-local time', () => {
  it('treats 7pm in Madison as evening even though it is midnight UTC', () => {
    // 2026-09-26T00:00Z is 7:00pm CDT on Sep 25
    expect(getTimeOfDay(new Date('2026-09-26T00:00:00Z'))).toBe('evening');
  });

  it('treats 8am in Madison as morning even though it is afternoon UTC', () => {
    // 2026-01-15T14:00Z is 8:00am CST
    expect(getTimeOfDay(new Date('2026-01-15T14:00:00Z'))).toBe('morning');
  });

  it('uses the Madison calendar date for seasons', () => {
    // 9pm Nov 30 in Madison is already Dec 1 in UTC
    expect(getSeason(new Date('2026-12-01T03:00:00Z'))).toBe('fall');
    expect(getSeason(new Date('2026-07-04T17:00:00Z'))).toBe('summer');
    expect(getSeason(new Date('2026-01-10T17:00:00Z'))).toBe('winter');
  });

  it('reports the Madison weekday', () => {
    // Saturday 1am in Madison is still Saturday 6am UTC
    expect(getLocalParts(new Date('2026-09-26T06:00:00Z')).weekday).toBe(6);
    // Friday 11pm in Madison is Saturday 4am UTC
    expect(getLocalParts(new Date('2026-09-26T04:00:00Z')).weekday).toBe(5);
  });

  it('converts Madison wall time to UTC across DST', () => {
    expect(fromLocalTime(2026, 6, 1, 19, 0).toISOString()).toBe('2026-07-02T00:00:00.000Z');
    expect(fromLocalTime(2026, 0, 1, 19, 0).toISOString()).toBe('2026-01-02T01:00:00.000Z');
  });
});

describe('parseICSDate', () => {
  it('reads UTC timestamps as UTC', () => {
    expect(parseICSDate('20260925T190000Z').toISOString()).toBe('2026-09-25T19:00:00.000Z');
  });

  it('reads floating / TZID timestamps as Madison time', () => {
    expect(parseICSDate('20260925T190000').toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(parseICSDate('20260125T190000').toISOString()).toBe('2026-01-26T01:00:00.000Z');
  });

  it('reads all-day dates as local midnight', () => {
    expect(parseICSDate('20260925').toISOString()).toBe('2026-09-25T05:00:00.000Z');
  });

  it('rejects junk', () => {
    expect(parseICSDate('')).toBeNull();
    expect(parseICSDate('tomorrow')).toBeNull();
  });
});
