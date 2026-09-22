import { normalizePhone } from './phone.normalizer.js';

describe('normalizePhone', () => {
  it('normalizes a space-separated local number', () => {
    expect(normalizePhone('0300 1234567')).toBe('03001234567');
  });

  it('normalizes a hyphenated local number', () => {
    expect(normalizePhone('0300-1234567')).toBe('03001234567');
  });

  it('normalizes an international +92 number to local form', () => {
    expect(normalizePhone('+92 300 1234567')).toBe('03001234567');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('normalizes the +92-hyphen format OLX displays', () => {
    expect(normalizePhone('+92-3237717536')).toBe('03237717536');
  });

  it('finds the number inside surrounding revealed text', () => {
    expect(normalizePhone('Huzaifa Mustafa  Call 0323-7717536 now')).toBe('03237717536');
  });

  it.each([
    ['a login prompt', 'Login to see the phone number'],
    ['price and time', 'Rs 5.29 Lac, 1 hour ago'],
    ['a date', '22.09.2026'],
  ])('returns empty rather than inventing a number from %s', (_label, raw) => {
    expect(normalizePhone(raw)).toBe('');
  });
});
