const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
};

/** Converts WordPress HTML into plain text with paragraph breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** First sentence-ish chunk of a text for list cards. */
export function makeExcerpt(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Lowercases and folds common Arabic spelling variants so search matches loosely. */
export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // tashkeel, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا') // alef variants
    .replace(/ى/g, 'ي') // alef maqsura -> yeh
    .replace(/ئ/g, 'ي') // yeh with hamza -> yeh
    .replace(/ؤ/g, 'و') // waw with hamza -> waw
    .replace(/ة/g, 'ه') // teh marbuta -> heh
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
