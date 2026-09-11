/** GCC phone rules, mirrored from the hub (vai_gcc_countries / vai_phone_intl / vai_phone_local). */
export type Country = {
  code: string;
  name: string;
  dial: string;
  flag: string;
  example: string;
  /** Local mobile number pattern (digits only). */
  local: RegExp;
};

export const COUNTRIES: readonly Country[] = [
  { code: 'sa', name: 'السعودية', dial: '966', flag: '🇸🇦', example: '0558318777', local: /^0?5\d{8}$/ },
  { code: 'ae', name: 'الإمارات', dial: '971', flag: '🇦🇪', example: '0501234567', local: /^0?5\d{8}$/ },
  { code: 'kw', name: 'الكويت', dial: '965', flag: '🇰🇼', example: '51234567', local: /^[569]\d{7}$/ },
  { code: 'qa', name: 'قطر', dial: '974', flag: '🇶🇦', example: '55123456', local: /^[3567]\d{7}$/ },
  { code: 'bh', name: 'البحرين', dial: '973', flag: '🇧🇭', example: '36123456', local: /^[3679]\d{7}$/ },
  { code: 'om', name: 'عُمان', dial: '968', flag: '🇴🇲', example: '91234567', local: /^[79]\d{7}$/ },
];

export const PHONE_POLICY_TEXT = 'التسجيل متاح للسعوديين والمقيمين ودول مجلس التعاون. اكتب رقم الجوال بدون مسافات وبدون رمز الدولة بهذا الشكل: 0558318777، أو اختر دولتك من القائمة.';
export const EMAIL_POLICY_TEXT = 'نقبل التسجيل ببريد Gmail أو iCloud أو Outlook، أو بريد عمل بدومين سعودي (.sa)';

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
  if (!country.local.test(digits)) return '';
  return country.dial + digits.replace(/^0+/, '');
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
