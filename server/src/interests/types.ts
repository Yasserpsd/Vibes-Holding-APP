import type { TopicKey } from '../news/types.js';

/**
 * M107: ONE unified interests list for the whole app (owner, 2026-10-20), ordered most to least
 * important. The same picks drive the news ranking (mapped to the classifier topics), the Projects
 * Bank «حسب اهتماماتي» filter (sector keywords), the agenda suggestions and the push targeting.
 * «أخرى» carries a short free text the owner reviews monthly from the dashboard.
 */
export type InterestKey =
  | 'startups'
  | 'tech'
  | 'invest'
  | 'realestate'
  | 'trade'
  | 'industry'
  | 'tourism'
  | 'health_edu'
  | 'energy'
  | 'other';

export type Interest = {
  key: InterestKey;
  label: string;
  labelEn: string;
  /** Which classifier topics this interest boosts in the news ranking. */
  newsTopics: TopicKey[];
  /** Arabic fragments matched against a Projects Bank sector name (and the project title). */
  sectorWords: string[];
};

export const INTERESTS: Interest[] = [
  { key: 'startups', label: 'ريادة الأعمال والشركات الناشئة', labelEn: 'Entrepreneurship & Startups', newsTopics: ['startups'], sectorWords: ['ريادة', 'ناشئ'] },
  { key: 'tech', label: 'التقنية والذكاء الاصطناعي', labelEn: 'Technology & AI', newsTopics: ['tech'], sectorWords: ['تقني', 'ذكاء', 'برمج', 'رقمي', 'تطبيق', 'اتصال'] },
  { key: 'invest', label: 'الاستثمار والتمويل والأسواق المالية', labelEn: 'Investment, Finance & Markets', newsTopics: ['markets', 'finance', 'economy'], sectorWords: ['استثمار', 'تمويل', 'مالي'] },
  { key: 'realestate', label: 'العقار والإنشاءات', labelEn: 'Real Estate & Construction', newsTopics: ['realestate'], sectorWords: ['عقار', 'إنشاء', 'انشاء', 'مقاول', 'بناء'] },
  { key: 'trade', label: 'التجارة والتجزئة والتجارة الإلكترونية', labelEn: 'Trade, Retail & E-commerce', newsTopics: ['retail'], sectorWords: ['تجار', 'تجزئة', 'متجر', 'تسوق', 'بيع'] },
  { key: 'industry', label: 'الصناعة واللوجستيات', labelEn: 'Industry & Logistics', newsTopics: ['industry'], sectorWords: ['صناع', 'لوجست', 'نقل', 'مصنع', 'شحن'] },
  { key: 'tourism', label: 'السياحة والترفيه والرياضة', labelEn: 'Tourism, Entertainment & Sports', newsTopics: ['tourism', 'sports'], sectorWords: ['سياح', 'ترفيه', 'رياضة', 'فندق', 'مطعم', 'ضياف', 'طعام', 'أغذية', 'اغذية'] },
  { key: 'health_edu', label: 'الصحة والتعليم', labelEn: 'Health & Education', newsTopics: [], sectorWords: ['صحة', 'صحي', 'طبي', 'مستشف', 'تعليم', 'تدريب', 'مدارس'] },
  { key: 'energy', label: 'الطاقة والتعدين', labelEn: 'Energy & Mining', newsTopics: ['energy'], sectorWords: ['طاقة', 'تعدين', 'نفط', 'كهرب', 'بيئة'] },
  { key: 'other', label: 'أخرى', labelEn: 'Other', newsTopics: [], sectorWords: [] },
];

/** The member picks 1 to 3 interests (owner, 2026-10-20). */
export const MAX_INTERESTS = 3;

export const INTEREST_KEYS = INTERESTS.map((interest) => interest.key) as InterestKey[];
const BY_KEY = new Map(INTERESTS.map((interest) => [interest.key, interest]));

export function isInterestKey(value: unknown): value is InterestKey {
  return typeof value === 'string' && BY_KEY.has(value as InterestKey);
}

export function interestOf(key: InterestKey): Interest {
  return BY_KEY.get(key) as Interest;
}

export function interestLabel(key: InterestKey, lang: 'ar' | 'en' = 'ar'): string {
  const interest = BY_KEY.get(key);
  return interest ? (lang === 'en' ? interest.labelEn : interest.label) : key;
}

/** The news classifier topics behind a set of interests (deduped, order kept). */
export function newsTopicsOf(keys: InterestKey[]): TopicKey[] {
  const topics: TopicKey[] = [];
  for (const key of keys) for (const topic of interestOf(key).newsTopics) if (!topics.includes(topic)) topics.push(topic);
  return topics;
}

/** Whether a Projects Bank sector (or title) text belongs to one of the member's interests. */
export function matchesInterests(keys: InterestKey[], text: string | null | undefined): boolean {
  if (!text) return false;
  for (const key of keys) for (const word of interestOf(key).sectorWords) if (text.includes(word)) return true;
  return false;
}

/** What this interest list looks like in one language, as the app and the registration screen show it. */
export function interestsFor(lang: 'ar' | 'en' = 'ar'): { key: InterestKey; label: string }[] {
  return INTERESTS.map((interest) => ({ key: interest.key, label: lang === 'en' ? interest.labelEn : interest.label }));
}
