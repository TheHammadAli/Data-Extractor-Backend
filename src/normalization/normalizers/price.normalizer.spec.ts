import { normalizePrice } from './price.normalizer.js';

describe('normalizePrice', () => {
  it('strips currency symbols and commas', () => {
    expect(normalizePrice('Rs. 2,500,000')).toBe('2500000');
  });

  it('converts Lakh to numeric', () => {
    expect(normalizePrice('PKR 25 Lakh')).toBe('2500000');
  });

  it('converts million to numeric', () => {
    expect(normalizePrice('2.5 million')).toBe('2500000');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePrice('')).toBe('');
  });
});
