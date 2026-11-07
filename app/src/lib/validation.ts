// Light client-side checks; the hub enforces the real rules and answers in Arabic.

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim().toLowerCase());
}

export type PhoneRules = { dial?: string; pattern?: string; min?: number; max?: number; starts?: string[] };

/**
 * M215 (owner, 2026-11-07): what is typed in a number field is cleaned as it is typed: Arabic-Indic digits folded, signs
 * dropped, every stray zero gone, and a pasted dial code removed once the number is too long to be a local one (so an
 * Indian 91… stays whole). The server applies the same cleaning for older bundles.
 */
export function localPhoneDigits(value: string, rules?: PhoneRules): string {
  const raw = value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D+/g, '');
  const digits = raw.replace(/^0+/, '');
  const dial = rules?.dial;
  if (!dial || !digits.startsWith(dial) || digits.length <= (rules?.max ?? 12)) return digits;
  return digits.slice(dial.length).replace(/^0+/, '');
}

/**
 * M128: checks a local mobile number against the country's rules (length + leading digits).
 * Returns 'bad' when the digits can no longer become a valid number (wrong start, too long,
 * or complete but failing the server pattern), 'short' while still typing, null when valid.
 */
export function phoneIssue(value: string, rules: PhoneRules | undefined): 'bad' | 'short' | null {
  const digits = localPhoneDigits(value, rules);
  const min = rules?.min ?? 8;
  const max = rules?.max ?? 12;
  const starts = rules?.starts ?? [];
  if (!digits) return 'short';
  const startLen = starts[0]?.length ?? 0;
  if (starts.length && digits.length >= startLen && !starts.some((start) => digits.startsWith(start))) return 'bad';
  if (digits.length > max) return 'bad';
  if (digits.length < min) return 'short';
  // The number is complete: the server pattern has the final say.
  if (rules?.pattern) {
    try {
      return new RegExp(rules.pattern).test(digits) ? null : 'bad';
    } catch {
      return null;
    }
  }
  return null;
}

/** True when the login field looks like a phone number rather than an e-mail. */
export function looksLikePhone(value: string): boolean {
  return /^[\d\s+()-]+$/.test(value.trim());
}

// ---------------------------------------------------------------------------------------------
// M195 (owner, 2026-11-04): real checks, not only «not empty». The server applies the same rules.

export type NameIssueKey = 'short' | 'oneWord' | 'symbols' | 'username' | 'kunya';

const KUNYA = new Set(['ابو', 'ابا', 'ابي', 'ام', 'بو', 'abu', 'abo', 'abou', 'um', 'umm', 'om', 'bu', 'bo']);
const foldArabic = (word: string) => word.toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/**
 * A real first name + family name: letters and spaces only, at least two words (an apostrophe or a hyphen
 * inside a word is fine: «Al-Otaibi»). Digits, dots, «@» and underscores mean a username («yasser4.designer»).
 */
export function nameIssue(value: string): NameIssueKey | null {
  const name = value.replace(/[ً-ْـٰ]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return 'short';
  if (/[@._0-9٠-٩]/.test(name)) return 'username';
  if (name.length < 5) return 'short';
  const words = name.split(' ').filter(Boolean);
  if (words.length < 2) return 'oneWord';
  for (const word of words) {
    // Explicit ranges (Arabic + Latin blocks) rather than \p{Script=…}: safe on every Hermes build.
    if (!/^[؀-ۿݐ-ݿA-Za-zÀ-ɏ][؀-ۿݐ-ݿA-Za-zÀ-ɏ'’-]*$/.test(word)) return 'symbols';
  }
  if (words.filter((word) => word.replace(/['’-]/g, '').length >= 2).length < 2) return 'oneWord';
  if (words.length === 2 && KUNYA.has(foldArabic(words[0] ?? '').replace(/^ال/, ''))) return 'kunya';
  return null;
}

export type IbanIssueKey = 'start' | 'length' | 'checksum';

/** Spaces out, upper case: what the server stores. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** A Saudi IBAN: «SA» + 22 characters (24 in all), passing the ISO 7064 mod-97 check. */
export function ibanIssue(value: string): IbanIssueKey | null {
  const iban = normalizeIban(value);
  if (!iban.startsWith('SA')) return 'start';
  if (iban.length !== 24 || !/^SA\d{2}[0-9A-Z]{20}$/.test(iban)) return 'length';
  return ibanMod97(iban) === 1 ? null : 'checksum';
}

/** ISO 7064 mod-97-10 over the rearranged IBAN, digit by digit (no BigInt needed). */
export function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const piece = code >= 65 && code <= 90 ? String(code - 55) : char;
    for (const digit of piece) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/** English letters only (spaces, dots, apostrophes and hyphens inside allowed): the bank's account holder name. */
export function isLatinName(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && /^[A-Za-z][A-Za-z\s.'’-]*$/.test(name);
}

export type AddressIssueKey = 'short' | 'name';

/**
 * An address, not a person's name: at least 10 characters and two words, and never equal to the names
 * the form already knows (owner: a member wrote his own name as the address).
 */
export function addressIssue(value: string, knownNames: string[]): AddressIssueKey | null {
  const address = value.replace(/\s+/g, ' ').trim();
  if (address.length < 10 || address.split(' ').length < 2) return 'short';
  if (looksLikePersonName(address)) return 'name';
  const folded = foldArabic(address);
  if (knownNames.some((name) => name.trim() && foldArabic(name.replace(/\s+/g, ' ').trim()) === folded)) return 'name';
  return null;
}

/** Words that make a line an address («حي», «شارع», "street", "building"…); shared with the server's rule. */
const ADDRESS_WORDS = /(حي|شارع|طريق|مبنى|مبني|عمارة|عماره|رقم|شقة|شقه|الدور|فيلا|فله|فلة|مجمع|مخطط|بجوار|بجانب|قرب|مقابل|تقاطع|دوار|ميدان|street|st\.|road|rd\.|district|dist\.|building|bldg|apartment|apt|villa|unit|floor|near|next to|avenue|ave\.|tower|complex|compound|block|p\.?o\.? box|zip)/i;

/** A few letter-only words with no digit, no punctuation and no address word read as a person's name. */
export function looksLikePersonName(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim();
  if (/[0-9٠-٩]/.test(text) || /[,،;:/\-–()]/.test(text) || ADDRESS_WORDS.test(text)) return false;
  const words = text.split(' ');
  return words.length <= 4 && words.every((word) => /^[؀-ۿA-Za-z'’.]+$/.test(word));
}
