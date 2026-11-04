/**
 * M195 (owner, 2026-11-04): a Saudi IBAN — «SA», two check digits, 22 more characters (24 in all) —
 * verified with the ISO 7064 mod-97-10 check, so a mistyped digit is caught before the record exists.
 * Mirrors app/src/lib/validation.ts; the server's verdict is the one that counts.
 */
export type IbanIssue = 'start' | 'length' | 'checksum';

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

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

export function saudiIbanIssue(value: string): IbanIssue | null {
  const iban = normalizeIban(value);
  if (!iban.startsWith('SA')) return 'start';
  if (iban.length !== 24 || !/^SA\d{2}[0-9A-Z]{20}$/.test(iban)) return 'length';
  return ibanMod97(iban) === 1 ? null : 'checksum';
}

export function ibanIssueMessage(issue: IbanIssue, lang: 'ar' | 'en' = 'ar'): string {
  if (lang === 'en') {
    return issue === 'start' ? 'A Saudi IBAN starts with SA' : issue === 'length' ? 'The IBAN is 24 characters: SA then 22 digits, no spaces' : 'This IBAN does not check out; copy it from your banking app';
  }
  return issue === 'start' ? 'الآيبان السعودي يبدأ بـ SA' : issue === 'length' ? 'الآيبان 24 خانة: SA ثم 22 رقمًا، بدون مسافات' : 'رقم الآيبان غير صحيح، راجعه من تطبيق البنك';
}
