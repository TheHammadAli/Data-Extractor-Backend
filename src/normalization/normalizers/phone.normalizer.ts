/** A run of digits with the separators people put inside phone numbers. No "." — "22.09.2026" is a date. */
const PHONE_CANDIDATE = /\+?\d[\d\s\-()]{5,20}\d/g;

function toLocalDigits(candidate: string): string {
  let digits = candidate.replace(/[^\d+]/g, '');
  if (digits.startsWith('+92')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('0092')) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith('92') && digits.length > 10) {
    digits = `0${digits.slice(2)}`;
  }
  return digits.replace(/\+/g, '');
}

/**
 * Finds the phone number in `raw` and returns it as "03001234567", or '' when there isn't one.
 *
 * Never builds a number out of unrelated digits: the text revealed after clicking "Show Phone
 * Number" can be a login prompt, a price or a timestamp, and stripping everything but digits from
 * that ("Rs 5.29 Lac, 1 hour ago" → "5291") would put an invented number in the CSV.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return '';
  for (const candidate of raw.match(PHONE_CANDIDATE) ?? []) {
    const digits = toLocalDigits(candidate);
    if (digits.length >= 7 && digits.length <= 15) return digits;
  }
  return '';
}
