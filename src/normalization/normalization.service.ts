import { Injectable } from '@nestjs/common';
import { normalizeDate } from './normalizers/date.normalizer.js';
import { normalizePhone } from './normalizers/phone.normalizer.js';
import { normalizePrice } from './normalizers/price.normalizer.js';
import { cleanText } from './normalizers/text.normalizer.js';

const PHONE_FIELDS = new Set([
  'contact_number', 'contact_no', 'contact', 'phone', 'phone_number', 'phone_no', 'mobile', 'mobile_number',
  'seller_phone', 'seller_phone_number', 'whatsapp',
]);
const DATE_FIELDS = new Set(['date', 'ad_date', 'posted_date', 'date_posted', 'posted_on', 'listed_date']);
const PRICE_FIELDS = new Set(['price']);

/**
 * Field names come from the user's own wording ("contact number", "Ad Date"), so match on a
 * canonical form — comparing the raw name against "contact_number" meant phone and date cleanup
 * silently never ran for those fields.
 */
function canonical(fieldKey: string): string {
  return fieldKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

@Injectable()
export class NormalizationService {
  normalizeField(fieldKey: string, rawValue: string): string {
    if (!rawValue) return '';
    const key = canonical(fieldKey);
    if (PHONE_FIELDS.has(key)) return normalizePhone(rawValue);
    if (DATE_FIELDS.has(key)) return normalizeDate(rawValue);
    if (PRICE_FIELDS.has(key)) return normalizePrice(rawValue);
    return cleanText(rawValue);
  }

  normalizeAll(data: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = this.normalizeField(key, value ?? '');
    }
    return result;
  }
}
