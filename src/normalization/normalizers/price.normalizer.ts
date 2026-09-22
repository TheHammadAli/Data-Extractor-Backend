/** Converts "Rs. 2,500,000" / "PKR 25 Lakh" / "2.5 million" into a plain numeric string. */
export function normalizePrice(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.trim().toLowerCase().replace(/rs\.?|pkr|₨|,/g, '').trim();

  const lakh = cleaned.match(/([\d.]+)\s*lakh/);
  if (lakh) return String(Math.round(parseFloat(lakh[1]) * 100_000));

  const crore = cleaned.match(/([\d.]+)\s*crore/);
  if (crore) return String(Math.round(parseFloat(crore[1]) * 10_000_000));

  const million = cleaned.match(/([\d.]+)\s*million/);
  if (million) return String(Math.round(parseFloat(million[1]) * 1_000_000));

  const thousand = cleaned.match(/([\d.]+)\s*(k|thousand)\b/);
  if (thousand) return String(Math.round(parseFloat(thousand[1]) * 1_000));

  const plain = cleaned.match(/[\d.]+/);
  if (plain) return String(Math.round(parseFloat(plain[0])));

  return raw.trim();
}
