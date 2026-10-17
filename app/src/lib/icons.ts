import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Server content names an icon family; only known names are used, anything else falls back. */
const ICONS: Record<string, IoniconName> = {
  briefcase: 'briefcase-outline',
  rocket: 'rocket-outline',
  compass: 'compass-outline',
  people: 'people-outline',
  'people-circle': 'people-circle-outline',
  ribbon: 'ribbon-outline',
  easel: 'easel-outline',
  school: 'school-outline',
  mic: 'mic-outline',
  business: 'business-outline',
  film: 'film-outline',
  chatbubbles: 'chatbubbles-outline',
  star: 'star-outline',
  megaphone: 'megaphone-outline',
  wallet: 'wallet-outline',
  globe: 'globe-outline',
  storefront: 'storefront-outline',
  pricetag: 'pricetag-outline',
  sparkles: 'sparkles-outline',
  time: 'time-outline',
  cart: 'cart-outline',
};

export function iconFor(name: string | null | undefined, fallback: IoniconName = 'sparkles-outline'): IoniconName {
  return (name && ICONS[name]) || fallback;
}

/**
 * M80: an icon matched to an Arabic label or heading («رأس المال», «الشركة», «المنافسون»…), so the
 * project page's fact rows and text headings read with visual signposts instead of bare words.
 * Keyword order matters: the first match wins.
 */
const TOPIC_ICONS: [RegExp, IoniconName][] = [
  [/رأس المال|تمويل|استثمار مطلوب|المبلغ/u, 'cash-outline'],
  [/تقييم|قيمة/u, 'trending-up-outline'],
  [/نسبة|شراكة|حصة/u, 'pie-chart-outline'],
  [/إيراد|أرباح|عائد|مبيعات|دخل/u, 'stats-chart-outline'],
  [/شركة|مؤسسة|سجل/u, 'business-outline'],
  [/مؤسس|فريق|شركاء|موظف/u, 'people-outline'],
  [/موقع|مدينة|منطقة|عنوان/u, 'location-outline'],
  [/تاريخ|تحديث|تأسيس|سنة/u, 'time-outline'],
  [/قطاع|مجال|نشاط/u, 'grid-outline'],
  [/مرحلة|جاهزية/u, 'flag-outline'],
  [/عرض|ملف|دراسة|خطة/u, 'document-attach-outline'],
  [/منافس|سوق/u, 'git-compare-outline'],
  [/هدف|رؤية|رسالة/u, 'rocket-outline'],
  [/مشكلة|تحدي|مخاطر/u, 'alert-circle-outline'],
  [/حل|ميزة|مميزات|نقاط القوة/u, 'bulb-outline'],
  [/منتج|خدمة|تطبيق|منصة/u, 'cube-outline'],
  [/عملاء|مستخدم|جمهور/u, 'person-circle-outline'],
  [/ترخيص|قانون|عقد/u, 'shield-checkmark-outline'],
  [/توسع|نمو|مستقبل|خطط/u, 'telescope-outline'],
];

export function topicIcon(text: string, fallback: IoniconName = 'information-circle-outline'): IoniconName {
  const match = TOPIC_ICONS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : fallback;
}
