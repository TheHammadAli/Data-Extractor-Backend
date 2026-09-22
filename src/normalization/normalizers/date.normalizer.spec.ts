import { normalizeDate } from './date.normalizer.js';

const REFERENCE = new Date('2026-09-22T12:00:00Z');

describe('normalizeDate', () => {
  it('resolves "Today" against the reference date', () => {
    expect(normalizeDate('Today', REFERENCE)).toBe('2026-09-22');
  });

  it('resolves "Yesterday" against the reference date', () => {
    expect(normalizeDate('Yesterday', REFERENCE)).toBe('2026-09-21');
  });

  it('parses "21 Sep 2026"', () => {
    expect(normalizeDate('21 Sep 2026')).toBe('2026-09-21');
  });

  it('parses "September 21, 2026"', () => {
    expect(normalizeDate('September 21, 2026')).toBe('2026-09-21');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeDate('')).toBe('');
  });

  it.each([
    ['1 hour ago', '2026-09-22'],
    ['17 minutes ago', '2026-09-22'],
    ['an hour ago', '2026-09-22'],
    ['3 days ago', '2026-09-19'],
    ['2 weeks ago', '2026-09-08'],
    ['just now', '2026-09-22'],
  ])('resolves OLX-style relative date "%s"', (raw, expected) => {
    expect(normalizeDate(raw, REFERENCE)).toBe(expected);
  });

  it('keeps text it cannot parse instead of blanking the column', () => {
    expect(normalizeDate('  Posted  recently ', REFERENCE)).toBe('Posted recently');
  });
});
