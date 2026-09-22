import { toFieldKey } from '../utils/text-similarity.js';

const SYNONYMS: Record<string, string> = {
  seller: 'seller_name',
  seller_name: 'seller_name',
  contact: 'contact_number',
  contact_number: 'contact_number',
  phone: 'contact_number',
  phone_number: 'contact_number',
  number: 'contact_number',
};

export function canonicalFieldKey(label: string): string {
  const key = toFieldKey(label);
  return SYNONYMS[key] ?? key;
}

export function parseFieldList(text: string): string[] {
  return text
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => canonicalFieldKey(part))
    .filter(Boolean);
}
