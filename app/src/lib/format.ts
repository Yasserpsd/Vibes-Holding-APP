/** Thousands separators without relying on Intl (partial on Hermes). */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatMillionsSar(millions: number): string {
  return `${formatNumber(millions)} مليون ريال`;
}

const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** "2027-09-06" → "6 سبتمبر 2027". Hyphenated dates flip visually inside Arabic text, so the month is spelled out. */
export function formatArabicDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const month = ARABIC_MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : isoDate;
}

/** "قبل 5 دقائق" / "قبل 3 ساعات" / "أمس" / a spelled-out date for anything older. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${formatNumber(minutes)} ${minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : minutes <= 10 ? 'دقائق' : 'دقيقة'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${formatNumber(hours)} ${hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : hours <= 10 ? 'ساعات' : 'ساعة'}`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${formatNumber(days)} أيام`;
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
