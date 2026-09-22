import { NormalizationService } from './normalization.service.js';

describe('NormalizationService field matching', () => {
  const service = new NormalizationService();

  it('applies phone cleanup to fields named the way users write them', () => {
    for (const field of ['contact number', 'Contact Number', 'contact_number', 'Seller Phone Number']) {
      expect(service.normalizeField(field, '+92-323 7717536')).toBe('03237717536');
    }
  });

  it('applies date cleanup to "Ad Date" as well as "date"', () => {
    for (const field of ['date', 'Ad Date', 'posted date']) {
      expect(service.normalizeField(field, '21 Sep 2026')).toBe('2026-09-21');
    }
  });

  it('leaves ordinary text fields as cleaned text', () => {
    expect(service.normalizeField('seller name', '  Huzaifa   Mustafa ')).toBe('Huzaifa Mustafa');
  });
});
