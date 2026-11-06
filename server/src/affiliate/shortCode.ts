/**
 * M198 + M202 (owner, 2026-11-06: «الكود صعب جدًا … 4 حروف ورقم واحد أو أقل، زي أول حروف الاسم مع رقم»):
 * every affiliate carries a very short alias next to his membership number: three Latin letters of his
 * name (Arabic transliterated letter by letter) and one digit, e.g. «FAR2». The older «FAR-27» aliases
 * stay valid as history. The alias is only a pointer: the server maps it back to the membership number
 * BEFORE the hub call, so the hub's referral channel (rule 2, the M32 channel) sees membership numbers only.
 *
 * Digits run 2 to 9 only: 0 and 1 never appear, so a typed 0 can only mean O and a typed 1 can only mean
 * I or L. codeKey() folds those together and uniqueness is checked on that key, so two aliases can never
 * differ by a look-alike character alone.
 */

/** Letter-by-letter Arabic → Latin, enough for a recognisable three-letter prefix. */
const ARABIC_LETTERS: Record<string, string> = {
  ا: 'A', أ: 'A', إ: 'A', آ: 'A', ٱ: 'A', ء: '', ئ: 'Y', ؤ: 'W',
  ب: 'B', ت: 'T', ث: 'TH', ج: 'J', ح: 'H', خ: 'KH', د: 'D', ذ: 'DH', ر: 'R', ز: 'Z',
  س: 'S', ش: 'SH', ص: 'S', ض: 'D', ط: 'T', ظ: 'Z', ع: 'A', غ: 'GH', ف: 'F', ق: 'Q',
  ك: 'K', ل: 'L', م: 'M', ن: 'N', ه: 'H', ة: 'H', و: 'W', ي: 'Y', ى: 'A',
  پ: 'P', چ: 'CH', ژ: 'ZH', گ: 'G', ک: 'K',
};

const FALLBACK_PREFIX = 'INV';
/** The digit of a new alias: never 0 or 1 (see the header). */
const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9];
const SPARE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/** Titles carry no identity: «د. محمد» starts at محمد, not at the title. */
const TITLE = /^(?:ال)?(?:دكتورة?|مهندسة?|[أا]ستاذة?|شيخ|د|م|أ|أ\.?د)\.?$/u;
const LATIN_TITLE = /^(?:dr|eng|engr|mr|mrs|ms|prof)\.?$/i;

/** The Latin letters of each word of the name: titles and the Arabic definite article dropped. */
function latinWords(name: string): string[] {
  const words = name.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && (TITLE.test(words[0] ?? '') || LATIN_TITLE.test(words[0] ?? ''))) words.shift();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw
      .replace(/^(ال|أل)(?=.{2})/u, '')
      .normalize('NFKD')
      .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
      .replace(/[̀-ͯ]/g, ''); // Latin diacritics
    let letters = '';
    for (const char of word) {
      if (/[A-Za-z]/.test(char)) letters += char.toUpperCase();
      else if (char in ARABIC_LETTERS) letters += ARABIC_LETTERS[char];
    }
    if (letters) out.push(letters);
  }
  return out;
}

const threeLetters = (letters: string): string => letters.slice(0, 3).padEnd(3, 'X');

/** The first three Latin letters of the name («فارس العتيبي» → FAR, «Khaled» → KHA, «Jo» → JOX). */
export function latinPrefix(name: string): string {
  const letters = latinWords(name).join('');
  return letters ? threeLetters(letters) : FALLBACK_PREFIX;
}

/** The prefixes to try, most natural first: the name, then the family name's letters, then one spare letter. */
function prefixesOf(name: string): string[] {
  const words = latinWords(name);
  const base = latinPrefix(name);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  const family = last ? [threeLetters(first.slice(0, 2) + last.slice(0, 1)), threeLetters(first.slice(0, 1) + last.slice(0, 2))] : [];
  return [...new Set([base, ...family, ...[...SPARE_LETTERS].map((letter) => base.slice(0, 2) + letter)])];
}

const easternDigit = (digit: string): string => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));

/** Upper case, Western digits, no spaces, separators or the invisible direction marks a copy from Arabic text carries. */
function compact(raw: string): string {
  return raw
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[٠-٩۰-۹]/g, easternDigit)
    .toUpperCase()
    .replace(/[\s._\-–—]+/g, '');
}

const LEGACY_SHAPE = /^([A-Z]{3})(\d{2,4})$/;
const CURRENT_SHAPE = /^[A-Z]{3,5}[2-9]?$/;

/** A pre-M202 alias: three letters, a dash and a number («FAR-27»). */
export function isLegacyCode(code: string | undefined): boolean {
  return !code || /^[A-Z]{3}-\d+$/.test(code);
}

/** «far2» → «FAR2», «far 27» → «FAR-27»; null when the text has neither shape. Exact: no look-alike folding. */
export function normalizeShortCode(raw: string): string | null {
  const clean = compact(raw);
  const legacy = clean.match(LEGACY_SHAPE);
  if (legacy) return `${legacy[1]}-${Number(legacy[2])}`;
  return CURRENT_SHAPE.test(clean) ? clean : null;
}

/**
 * The forgiving form two aliases are compared in: O = 0 and I = L = 1, whatever the case or spacing.
 * Null when the text cannot be an alias at all (a membership number is never one).
 */
export function codeKey(raw: string): string | null {
  const clean = compact(raw);
  const legacy = clean.match(LEGACY_SHAPE);
  const body = legacy ? `${legacy[1]}${Number(legacy[2])}` : clean;
  if (!/^[A-Z0-9]{3,8}$/.test(body)) return null;
  return body.replace(/0/g, 'O').replace(/[1L]/g, 'I');
}

/** A fresh alias for this name: the first prefix and digit that are free among the codes already taken. */
export function newShortCode(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((code) => codeKey(code)));
  const prefixes = prefixesOf(name);
  for (const prefix of prefixes) {
    for (const digit of DIGITS) {
      const candidate = `${prefix}${digit}`;
      if (!used.has(codeKey(candidate))) return candidate;
    }
  }
  // Over two hundred people sharing one name: the older dashed shape still reads and resolves.
  for (let n = 10; ; n += 1) {
    const candidate = `${prefixes[0]}-${n}`;
    if (!used.has(codeKey(candidate))) return candidate;
  }
}
