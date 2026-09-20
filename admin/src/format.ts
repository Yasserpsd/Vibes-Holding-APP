/** Arabic wording with Latin digits and the Gregorian calendar, as everywhere else in the project. */
const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const RIYADH = 'Asia/Riyadh';

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// Months are spelled out: a numeric date flips inside Arabic text and hides which part is the day.
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: RIYADH });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDayFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short', timeZone: RIYADH });

export const formatNumber = (value: number | null | undefined): string => (typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '—');

const CURRENCIES: Record<string, string> = { SAR: 'ريال', EGP: 'جنيه', USD: 'دولار' };
/** A hub row may come with no currency at all (null, not only a missing key): the club charges in riyals. An unknown code shows as it came. */
function currencyName(code: string | null | undefined): string {
  const key = String(code || 'SAR').toUpperCase();
  return CURRENCIES[key] ?? key;
}

/** "1,899 ريال". Aggregates carry no currency of their own: the club's payments are in riyals. */
export const formatMoney = (amount: number, currency?: string | null): string => `${moneyFormat.format(amount)} ${currencyName(currency)}`;
export const formatCents = (cents: number, currency?: string | null): string => formatMoney(cents / 100, currency);

/** Reads a hub time (UTC `Y-m-d H:i:s`) or an ISO string; NaN when it is neither. */
export function parseTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

/** Date and time in Riyadh, where the club and its daily numbers live. */
export function formatDateTime(value: string | null | undefined): string {
  const at = parseTime(value);
  return Number.isNaN(at) ? '—' : dateTimeFormat.format(at);
}

export function formatTime(value: string | null | undefined): string {
  const at = parseTime(value);
  return Number.isNaN(at) ? '' : timeFormat.format(at);
}

const dayOf = (day: string): number => Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);

/** A calendar day (`2026-10-05`, already a Riyadh day): spelled out, because hyphenated dates flip inside Arabic text. */
export function formatDay(day: string | null | undefined, style: 'medium' | 'short' | 'long' = 'medium'): string {
  const at = day ? dayOf(day) : Number.NaN;
  if (Number.isNaN(at)) return '—';
  return (style === 'short' ? shortDayFormat : style === 'long' ? longDayFormat : dateFormat).format(at);
}

/** An event's `date`: a bare day stays a day, an exact time shows its Riyadh hour too. */
export const formatEventDate = (value: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value) : formatDateTime(value));

/**
 * Arabic counted noun: singular and dual without a numeral, 3 to 10 with the plural, 11 to 99 with the accusative
 * singular (يومًا), and the hundreds follow their last two digits.
 */
export function arabicCount(count: number, singular: string, dual: string, plural: string, accusative = singular, one = singular): string {
  if (count === 1) return one;
  if (count === 2) return dual;
  const rest = count % 100;
  return `${formatNumber(count)} ${rest >= 3 && rest <= 10 ? plural : rest >= 11 ? accusative : singular}`;
}

/** `dual`: «يومين» after a preposition («بمقدار يومين»), «يومان» elsewhere. */
export const formatDays = (days: number, dual = 'يومان'): string => arabicCount(days, 'يوم', dual, 'أيام', 'يومًا', 'يوم واحد');
export const formatProjects = (count: number, dual = 'مشروعان'): string => arabicCount(count, 'مشروع', dual, 'مشاريع', 'مشروعًا', 'مشروع واحد');
/** Days left on a membership: «اليوم» when it ends today. */
export const daysText = (days: number): string => (days <= 0 ? 'اليوم' : formatDays(days));

/** "قبل 5 دقائق" / "أمس" / a spelled-out date for anything older. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  const then = parseTime(value);
  if (Number.isNaN(then)) return '—';
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${arabicCount(minutes, 'دقيقة', 'دقيقتين', 'دقائق')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${arabicCount(hours, 'ساعة', 'ساعتين', 'ساعات')}`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${arabicCount(days, 'يوم', 'يومين', 'أيام')}`;
  return dateFormat.format(then + 3 * 3_600_000);
}

/** A date the hub stores as its admin typed it: a leading `2026-10-17` is spelled out (its hour kept), anything else stays as written. */
export function formatLooseDate(value: string | null | undefined): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(value ?? '');
  if (!match?.[1]) return value ?? '';
  return match[2] ? `${formatDay(match[1])} · ${match[2]}` : formatDay(match[1]);
}
