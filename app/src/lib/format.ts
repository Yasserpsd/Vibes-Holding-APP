import { getLang, t } from '@/i18n';

/** Thousands separators without relying on Intl (partial on Hermes). */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMillionsSar(millions: number): string {
  return t('common.millionSar', { amount: formatNumber(millions) });
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

/**
 * M70: the days a multi-day workshop runs, in words (never a hyphen between two numbers).
 * Consecutive days read «من 3 إلى 5 نوفمبر 2026»; hand-picked days of one month read
 * «3، 5، 7 نوفمبر 2026»; across months, the full dates joined by «، ». One day = formatArabicDate.
 */
export function formatEventDays(dates: string[] | undefined, date: string): string {
  const days = dates && dates.length > 1 ? dates : null;
  if (!days) return formatArabicDate(date);
  const first = days[0] ?? date;
  const last = days.at(-1) ?? date;
  const en = getLang() === 'en';
  const sameMonth = days.every((day) => day.slice(0, 7) === first.slice(0, 7));
  const consecutive = days.every((day, index) => index === 0 || Date.parse(`${day}T12:00:00Z`) - Date.parse(`${days[index - 1]}T12:00:00Z`) === 86_400_000);
  if (consecutive) {
    const start = sameMonth ? String(Number(first.slice(8, 10))) : formatArabicDate(first);
    return en ? `${start} to ${formatArabicDate(last)}` : `من ${start} إلى ${formatArabicDate(last)}`;
  }
  if (sameMonth) {
    const tail = formatArabicDate(last);
    const headDays = days.slice(0, -1).map((day) => String(Number(day.slice(8, 10))));
    return en ? `${headDays.join(', ')} and ${tail}` : `${headDays.join('، ')} و${tail}`;
  }
  return days.map(formatArabicDate).join(en ? ', ' : '، ');
}

/** M109a: a booking duration in words — «ساعة»، «ساعتان»، «5 ساعات» (EN: "2 hours"). */
export function formatHours(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 hour' : `${count} hours`;
  return arabicCount(count, 'ساعة', 'ساعتان', 'ساعات');
}

/** The multi-day pill on event cards: «يومان»، «3 أيام» (EN: "2 days"). */
export function formatDayCount(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 day' : `${count} days`;
  return arabicCount(count, 'يوم', 'يومان', 'أيام');
}

/** Arabic counted noun: singular and dual without a numeral (ساعة، ساعتين), 3 to 10 with the plural (5 ساعات), 11 and up with the singular (15 ساعة). */
function arabicCount(count: number, singular: string, dual: string, plural: string): string {
  if (count === 1) return singular;
  if (count === 2) return dual;
  return `${formatNumber(count)} ${count <= 10 ? plural : singular}`;
}

/** Icons pass: a services group's size under its header — «خدمة»، «خدمتان»، «5 خدمات» (EN: "5 services"). */
export function formatServiceCount(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 service' : `${count} services`;
  return arabicCount(count, 'خدمة', 'خدمتان', 'خدمات');
}

/** Icons pass: the bank's sector spread — «قطاع»، «قطاعان»، «8 قطاعات» (EN: "8 sectors"). */
export function formatSectorCount(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 sector' : `${count} sectors`;
  return arabicCount(count, 'قطاع', 'قطاعان', 'قطاعات');
}

/** Icons pass: the «شخصية ومسيرة» roster size — «شخصية»، «شخصيتان»، «5 شخصيات» (EN: "5 figures"). */
export function formatPeopleCount(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 figure' : `${count} figures`;
  return arabicCount(count, 'شخصية', 'شخصيتان', 'شخصيات');
}

/** Icons pass: the news feed's size — «خبر»، «خبران»، «8 أخبار» (EN: "8 news items"). */
export function formatNewsCount(count: number): string {
  if (getLang() === 'en') return count === 1 ? '1 news item' : `${count} news items`;
  return arabicCount(count, 'خبر', 'خبران', 'أخبار');
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

const WEEKDAY_KEYS = ['time.sunday', 'time.monday', 'time.tuesday', 'time.wednesday', 'time.thursday', 'time.friday', 'time.saturday'] as const;

/** The weekday name of a JavaScript day index (Sunday = 0), in the app's language; '' for anything else. */
export function weekdayName(day: number): string {
  const key = WEEKDAY_KEYS[day];
  return key ? t(key) : '';
}

/** The weekday of a "2026-09-22" date. */
export function weekdayOf(isoDate: string): string {
  return weekdayName(new Date(`${isoDate}T00:00:00Z`).getUTCDay());
}

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
