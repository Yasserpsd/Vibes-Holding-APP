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

export const PHONE_POLICY_TEXT = 'التسجيل متاح من أي دولة في العالم. اختر دولتك من القائمة واكتب رقم الجوال بدون مسافات وبدون رمز الدولة — في السعودية مثلًا بهذا الشكل: 0558318777.';
export const EMAIL_POLICY_TEXT = 'نقبل التسجيل بأي بريد إلكتروني صحيح، شخصي أو بريد عمل — يصلك عليه رمز التفعيل';

export function countryByCode(code: string | undefined): Country | undefined {
  return COUNTRIES.find((country) => country.code === (code ?? 'sa').toLowerCase());
}

/** Validates a local mobile number for a country and returns international digits (9665…) or ''. */
export function phoneIntl(countryCode: string | undefined, local: string): string {
  const country = countryByCode(countryCode);
  if (!country) return '';
  let digits = local.replace(/\D+/g, '');
  if (digits.startsWith(`00${country.dial}`)) digits = digits.slice(2 + country.dial.length);
  else if (digits.startsWith(country.dial) && digits.length > country.dial.length + 7) digits = digits.slice(country.dial.length);
  if (country.local) {
    if (!country.local.test(digits)) return '';
    return country.dial + digits.replace(/^0+/, '');
  }
  const generic = digits.replace(/^0+/, '');
  if (!GENERIC_LOCAL.test(generic) || (country.dial + generic).length > 15) return '';
  return country.dial + generic;
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
  return digits;
}

export function normEmail(input: string): string {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}
