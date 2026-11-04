/**
 * M195 (owner, 2026-11-04: «المدينة: اختيار من قائمة مدن مش كتابة حرة، عشان أخطاء زي Dammqm»): the Saudi
 * cities an affiliate picks his city of residence from. The key is what the app sends; the Arabic name
 * is what the record, the admin mail and the dashboard carry; the English name is the English app's label.
 * «أخرى» stays last for the small towns — the member then types the name, letters only.
 */
export type City = { key: string; ar: string; en: string };

export const OTHER_CITY = 'other';

export const SAUDI_CITIES: readonly City[] = [
  { key: 'riyadh', ar: 'الرياض', en: 'Riyadh' },
  { key: 'jeddah', ar: 'جدة', en: 'Jeddah' },
  { key: 'makkah', ar: 'مكة المكرمة', en: 'Makkah' },
  { key: 'madinah', ar: 'المدينة المنورة', en: 'Madinah' },
  { key: 'dammam', ar: 'الدمام', en: 'Dammam' },
  { key: 'khobar', ar: 'الخبر', en: 'Al Khobar' },
  { key: 'dhahran', ar: 'الظهران', en: 'Dhahran' },
  { key: 'jubail', ar: 'الجبيل', en: 'Jubail' },
  { key: 'qatif', ar: 'القطيف', en: 'Qatif' },
  { key: 'ahsa', ar: 'الأحساء', en: 'Al Ahsa' },
  { key: 'hafar', ar: 'حفر الباطن', en: 'Hafar Al Batin' },
  { key: 'khafji', ar: 'الخفجي', en: 'Al Khafji' },
  { key: 'taif', ar: 'الطائف', en: 'Taif' },
  { key: 'yanbu', ar: 'ينبع', en: 'Yanbu' },
  { key: 'rabigh', ar: 'رابغ', en: 'Rabigh' },
  { key: 'buraidah', ar: 'بريدة', en: 'Buraidah' },
  { key: 'unaizah', ar: 'عنيزة', en: 'Unaizah' },
  { key: 'rass', ar: 'الرس', en: 'Ar Rass' },
  { key: 'hail', ar: 'حائل', en: 'Hail' },
  { key: 'tabuk', ar: 'تبوك', en: 'Tabuk' },
  { key: 'abha', ar: 'أبها', en: 'Abha' },
  { key: 'khamis', ar: 'خميس مشيط', en: 'Khamis Mushait' },
  { key: 'bisha', ar: 'بيشة', en: 'Bisha' },
  { key: 'najran', ar: 'نجران', en: 'Najran' },
  { key: 'jazan', ar: 'جازان', en: 'Jazan' },
  { key: 'sabya', ar: 'صبيا', en: 'Sabya' },
  { key: 'baha', ar: 'الباحة', en: 'Al Baha' },
  { key: 'sakaka', ar: 'سكاكا', en: 'Sakaka' },
  { key: 'qurayyat', ar: 'القريات', en: 'Al Qurayyat' },
  { key: 'arar', ar: 'عرعر', en: 'Arar' },
  { key: 'kharj', ar: 'الخرج', en: 'Al Kharj' },
  { key: 'majmaah', ar: 'المجمعة', en: 'Al Majmaah' },
  { key: 'zulfi', ar: 'الزلفي', en: 'Az Zulfi' },
  { key: 'dawadmi', ar: 'الدوادمي', en: 'Ad Dawadmi' },
  { key: 'afif', ar: 'عفيف', en: 'Afif' },
  { key: 'wadi', ar: 'وادي الدواسر', en: 'Wadi Ad Dawasir' },
  { key: 'alula', ar: 'العلا', en: 'AlUla' },
  { key: 'duba', ar: 'ضباء', en: 'Duba' },
  { key: 'qunfudhah', ar: 'القنفذة', en: 'Al Qunfudhah' },
  { key: 'sharurah', ar: 'شرورة', en: 'Sharurah' },
  { key: 'other', ar: 'أخرى', en: 'Other' },
];

const byKey = new Map(SAUDI_CITIES.map((city) => [city.key, city]));
const foldArabic = (value: string) => value.trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
const byName = new Map(SAUDI_CITIES.flatMap((city) => [[foldArabic(city.ar), city], [city.en.toLowerCase(), city]] as [string, City][]));

export function cityByKey(key: string): City | undefined {
  return byKey.get(key.trim().toLowerCase());
}

/** The key behind a stored Arabic (or English) city name — 'other' when the name is not in the list. */
export function cityKeyOf(name: string): string {
  const found = byName.get(foldArabic(name));
  return found && found.key !== OTHER_CITY ? found.key : OTHER_CITY;
}

/** The pick list in the reader's language, «أخرى / Other» last. */
export function cityChoices(lang: 'ar' | 'en'): { value: string; label: string }[] {
  return SAUDI_CITIES.map((city) => ({ value: city.key, label: lang === 'en' ? city.en : city.ar }));
}

/** Letters (Arabic or Latin), spaces, apostrophes and hyphens: a typed city name. */
export const CITY_NAME = /^[؀-ۿA-Za-z][؀-ۿA-Za-z\s'’-]{2,59}$/;
