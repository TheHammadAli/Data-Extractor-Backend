/** Strips HTML tags and collapses extra whitespace/line breaks while preserving the actual text content. */
export function cleanText(raw: string): string {
  if (!raw) return '';
  const withoutHtml = raw.replace(/<[^>]*>/g, ' ');
  return withoutHtml.replace(/\s+/g, ' ').trim();
}
