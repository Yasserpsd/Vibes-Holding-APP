/**
 * M198 (owner, 2026-11-04: «الرقم الطويل مش حلو؛ أول 3 حروف من اسمه معاه رقم»): every affiliate
 * carries a short alias next to his membership number — the first three Latin letters of his name
 * (Arabic transliterated letter by letter) plus a short number that keeps it unique, e.g. «FAR-27».
 * The alias is only a pointer: the server maps it back to the membership number BEFORE the hub call,
 * so the hub's referral channel (rule 2, the M32 channel) never sees anything but membership numbers.
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

/** The first Latin word of the name, the Arabic definite article dropped («الفارس» → FARS, «Khaled» → KHALED). */
export function latinPrefix(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[̀-ͯ]/g, '') // Latin diacritics
    .split(/\s+/)
    .filter(Boolean);
  let letters = '';
  for (const raw of words) {
    const word = raw.replace(/^(ال|أل)(?=.{2})/u, '');
    for (const char of word) {
      if (/[A-Za-z]/.test(char)) letters += char.toUpperCase();
      else if (char in ARABIC_LETTERS) letters += ARABIC_LETTERS[char];
    }
    if (letters.length >= 3) break;
  }
  return letters ? letters.slice(0, 3).padEnd(3, 'X') : FALLBACK_PREFIX;
}

const SHORT_CODE = /^([A-Z]{3})[\s._-]*(\d{1,4})$/;
const easternDigit = (digit: string): string => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));

/** «far 27», «FAR-27», «far27», Arabic digits → «FAR-27»; null when it is not a short code. */
export function normalizeShortCode(raw: string): string | null {
  const match = raw
    .trim()
    .replace(/[٠-٩۰-۹]/g, easternDigit)
    .toUpperCase()
    .match(SHORT_CODE);
  return match ? `${match[1]}-${Number(match[2])}` : null;
}

/**
 * A fresh alias for this name: the prefix plus a two-digit number seeded from the contact id, moved
 * up until it is free among the codes already taken.
 */
export function newShortCode(name: string, contactId: number, taken: Iterable<string>): string {
  const used = new Set([...taken].map((code) => code.toUpperCase()));
  const prefix = latinPrefix(name);
  let n = 10 + (Math.abs(Math.trunc(contactId)) % 90);
  for (;;) {
    const candidate = `${prefix}-${n}`;
    if (!used.has(candidate)) return candidate;
    n += 1;
  }
}
