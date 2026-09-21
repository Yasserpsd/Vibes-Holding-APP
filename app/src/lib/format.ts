import { getLang, t } from '@/i18n';

/** Thousands separators without relying on Intl (partial on Hermes). */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMillionsSar(millions: number): string {
  return `${formatNumber(millions)} مليون ريال`;
}

const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ENGLISH_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "2027-09-06" → "6 سبتمبر 2027" ("6 September 2027" in the English version). Hyphenated dates flip visually
 * inside Arabic text, so the month is spelled out.
 */
export function formatArabicDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const month = (getLang() === 'en' ? ENGLISH_MONTHS : ARABIC_MONTHS)[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : isoDate;
}

/** Arabic counted noun: singular and dual without a numeral (ساعة، ساعتين), 3 to 10 with the plural (5 ساعات), 11 and up with the singular (15 ساعة). */
function arabicCount(count: number, singular: string, dual: string, plural: string): string {
  if (count === 1) return singular;
  if (count === 2) return dual;
  return `${formatNumber(count)} ${count <= 10 ? plural : singular}`;
}

/** "قبل 5 دقائق" / "قبل ساعتين" / "أمس" / a spelled-out date for anything older. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return t('time.now');
  if (getLang() === 'en') return englishRelativeTime(minutes, then);
  if (minutes < 60) return `قبل ${arabicCount(minutes, 'دقيقة', 'دقيقتين', 'دقائق')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${arabicCount(hours, 'ساعة', 'ساعتين', 'ساعات')}`;
  const days = Math.round(hours / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return `قبل ${arabicCount(days, 'يوم', 'يومين', 'أيام')}`;
  return formatArabicDate(new Date(then).toISOString());
}

/** The same steps in English: "5 min ago", "2 hr ago", "yesterday", "3 days ago", then the date. */
function englishRelativeTime(minutes: number, then: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return `${days} days ago`;
  return formatArabicDate(new Date(then).toISOString());
}

/** Weekday names, Sunday first (JavaScript's getDay order). */
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** "12 سبتمبر 2026 · 14:05" in the device's local time, for timestamps such as a booking time. */
export function formatArabicDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${formatArabicDate(day)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** An event's date as the dashboard saved it: a day ("2026-10-05") or an exact time, shown in the device's local time. */
export function formatEventDate(value: string): string {
  const date = value.trim();
  // A day alone has no time to show; parsed as a date it would be UTC midnight, a made-up hour on the member's phone.
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatArabicDate(date) : formatArabicDateTime(date);
}
