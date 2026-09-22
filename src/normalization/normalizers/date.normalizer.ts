const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const RELATIVE = /^(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/;

/** "3 days ago" / "an hour ago" relative to the reference date — how OLX and most classifieds show it. */
function fromRelative(lower: string, referenceDate: Date): Date | null {
  if (lower === 'just now') return new Date(referenceDate);
  const match = RELATIVE.exec(lower);
  if (!match) return null;

  const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
  const d = new Date(referenceDate);
  switch (match[2]) {
    case 'second':
      d.setSeconds(d.getSeconds() - amount);
      break;
    case 'minute':
      d.setMinutes(d.getMinutes() - amount);
      break;
    case 'hour':
      d.setHours(d.getHours() - amount);
      break;
    case 'day':
      d.setDate(d.getDate() - amount);
      break;
    case 'week':
      d.setDate(d.getDate() - amount * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() - amount);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() - amount);
      break;
  }
  return d;
}

/**
 * Converts "Today"/"Yesterday"/"3 days ago"/"21 Sep 2026"/"September 21, 2026" into ISO 8601
 * ("2026-09-21"). Anything it can't parse is kept as the site's own text rather than dropped —
 * a blank date column loses information the page actually showed.
 */
export function normalizeDate(raw: string, referenceDate: Date = new Date()): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const lower = trimmed.toLowerCase();

  if (lower === 'today') return toIsoDate(referenceDate);
  if (lower === 'yesterday') {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }

  const relative = fromRelative(lower, referenceDate);
  if (relative) return toIsoDate(relative);

  const dayMonthYear = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const monthIndex = MONTHS.findIndex((m) => m.startsWith(dayMonthYear[2].toLowerCase().slice(0, 3)));
    if (monthIndex >= 0) {
      const d = new Date(Date.UTC(Number(dayMonthYear[3]), monthIndex, Number(dayMonthYear[1])));
      if (!Number.isNaN(d.getTime())) return toIsoDate(d);
    }
  }

  const monthDayYear = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDayYear) {
    const monthIndex = MONTHS.findIndex((m) => m.startsWith(monthDayYear[1].toLowerCase().slice(0, 3)));
    if (monthIndex >= 0) {
      const d = new Date(Date.UTC(Number(monthDayYear[3]), monthIndex, Number(monthDayYear[2])));
      if (!Number.isNaN(d.getTime())) return toIsoDate(d);
    }
  }

  // Last resort: native parsing, interpreted as UTC to avoid local-timezone day-shift.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const utcSafe = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    return toIsoDate(utcSafe);
  }

  return trimmed;
}
