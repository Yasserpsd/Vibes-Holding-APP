import { dropTrunkZero } from '../hub/phone.js';

/**
 * M174: phone numbers for the WhatsApp Cloud API are E.164 digits without «+» (9665xxxxxxxx).
 * Returns null when the input cannot be a dialable number, so the caller falls back to e-mail.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Arabic-Indic digits come from keyboards in the app; fold them to Latin first.
  const latin = String(raw).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const international = /^\s*(\+|00)/.test(latin);
  let digits = latin.replace(/\D/g, '');
  if (!digits) return null;
  const doubled = /^\s*00/.test(latin);
  if (doubled) digits = digits.replace(/^00/, '');

  // Saudi: 05xxxxxxxx, 5xxxxxxxx, 9665xxxxxxxx and the slips +966 05xxxxxxxx, 0966…, 005xxxxxxxx (a zero typed twice).
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits) && (!international || doubled)) return `966${digits}`;
  if (/^0*9660*5\d{8}$/.test(digits)) return `966${digits.replace(/^0*9660*/, '')}`;

  // Any other country is kept as given, but only when it was written with its country code.
  if (!international && digits.startsWith('0')) return null;
  digits = dropTrunkZero(digits);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Logs and errors only ever carry the last four digits of a member's number. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : '***';
}
