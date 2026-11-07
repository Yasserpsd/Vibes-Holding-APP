/** Phone rules, mirrored from the hub (vai_gcc_countries / vai_phone_intl / vai_phone_local).
 * Since the world list (2.16.0): GCC keep strict local rules, every other country passes a
 * generic length check (5–12 digits after the dial code, E.164 total of 15 max).
 */
import { COUNTRY_ROWS, type CountryRow } from './countries.js';

export type Country = CountryRow;

export const COUNTRIES: readonly Country[] = COUNTRY_ROWS;

/** Generic world rule for countries without a strict pattern (digits after the dial code, leading zeros stripped). */
const GENERIC_LOCAL = /^\d{5,12}$/;
/** Loose client-side pattern sent to the app for countries without a strict rule. */
export const GENERIC_PATTERN = '^0*\\d{5,12}$';

/** Countries whose national number really starts with 0, so the digit after the dial code is never a slip. */
const KEEPS_ZERO = new Set(['39', '225', '229', '241', '242']);
const DIALS = [...new Set(COUNTRY_ROWS.map((country) => country.dial))].sort((a, b) => b.length - a.length);

/** International digits with a stray trunk zero after the dial code («20 0100…» → «20 100…»). */
export function dropTrunkZero(digits: string): string {
  const dial = DIALS.find((code) => digits.startsWith(code));
  if (!dial || KEEPS_ZERO.has(dial) || digits[dial.length] !== '0') return digits;
  return dial + digits.slice(dial.length).replace(/^0+/, '');
}

/**
 * What a member typed → the national digits: Arabic-Indic digits folded, signs and spaces dropped, the dial code and
 * every stray leading zero gone (owner, 2026-11-07: a zero typed by mistake is cleaned, never rejected). '' when no digit.
 */
export function nationalDigits(typed: string, countryCode?: string): string {
  const raw = typed
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D+/g, '');
  const digits = raw.replace(/^0+/, '');
  const country = countryByCode(countryCode);
  // A local number that merely starts like the dial code stays whole (an Indian 91…).
  if (!country || !digits.startsWith(country.dial) || country.local?.test(digits)) return digits;
  const dial = country.dial;
  return raw.startsWith('00') || digits.length > dial.length + 7 ? digits.slice(dial.length).replace(/^0+/, '') : digits;
}

/** The two countries the hub keeps as 05…; every other strict rule there refuses a leading zero. */
const ZERO_FIRST = new Set(['sa', 'ae']);

/** The number as the hub takes it: clean national digits, with the one leading zero of the 05… countries; as typed when it holds no digit, so the hub answers. */
export function hubNumber(typed: string, countryCode?: string): string {
  const digits = nationalDigits(typed, countryCode);
  if (!digits) return typed;
  return ZERO_FIRST.has((countryCode ?? 'sa').toLowerCase()) ? `0${digits}` : digits;
}

export const PHONE_POLICY_TEXT = 'التسجيل متاح من أي دولة في العالم. اختر دولتك من القائمة واكتب رقم الجوال بدون مسافات وبدون رمز الدولة وبدون الصفر الأول — في السعودية مثلًا: 512345678.';
export const EMAIL_POLICY_TEXT = 'نقبل التسجيل بأي بريد إلكتروني صحيح، شخصي أو بريد عمل — يصلك عليه رمز التفعيل';

export function countryByCode(code: string | undefined): Country | undefined {
  return COUNTRIES.find((country) => country.code === (code ?? 'sa').toLowerCase());
}

/** Validates a local mobile number for a country and returns international digits (9665…) or ''. */
export function phoneIntl(countryCode: string | undefined, local: string): string {
  const country = countryByCode(countryCode);
  if (!country) return '';
  const digits = nationalDigits(local, countryCode);
  if (country.local) return country.local.test(digits) ? country.dial + digits : '';
  if (!GENERIC_LOCAL.test(digits) || (country.dial + digits).length > 15) return '';
  return country.dial + digits;
}

/** Display form: Saudi numbers as 05XXXXXXXX; other countries as plain digits. */
export function phoneLocal(phone: string): string {
  let digits = phone.replace(/\D+/g, '');
  if (digits.startsWith('00966')) digits = digits.slice(2);
  if (digits.startsWith('966') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith('05')) return digits;
  if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`;
  return digits;
}

/** Loose normalisation for logins typed as a phone number (vai_norm_phone). */
export function normPhone(input: string): string {
  let digits = input.replace(/\D+/g, '');
  if (digits === '') return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `966${digits.slice(1)}`;
  else if (digits.length === 9 && digits.startsWith('5')) digits = `966${digits}`;
  return dropTrunkZero(digits);
}

/**
 * What the member typed in the login field → what the hub matches on: a clean e-mail, or
 * international phone digits. The chosen country supplies the dial code (world-wide, not the
 * hub's Saudi-biased vai_norm_phone); a number typed with + or 00 keeps its own dial code.
 * Anything else passes through unchanged so the hub answers with its own message.
 */
export function normLogin(input: string, countryCode?: string): string {
  const email = normEmail(input);
  if (email) return email;
  const raw = input.trim();
  const digits = raw.replace(/\D+/g, '');
  if (!/^[\d\s+().-]+$/.test(raw) || digits.length < 5) return raw;
  if (raw.includes('+') || digits.startsWith('00')) return normPhone(raw);
  return phoneIntl(countryCode ?? 'sa', raw) || normPhone(raw);
}

export function normEmail(input: string): string {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}
