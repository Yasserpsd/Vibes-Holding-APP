import type { KV } from '../store.js';

/** HQ page and booking rules. Editable server content (hours and capacity are the dashboard's to change). */
export type HqContent = {
  title: string;
  intro: string;
  address: string;
  mapUrl: string;
  tourVideoId: string;
  facilities: string[];
  rules: string[];
  memberOnlyText: string;
  guestText: string;
  /** Booking window: 0 = Sunday … 6 = Saturday; times are Riyadh local time (UTC+3). */
  hours: { days: number[]; open: string; close: string; slotMinutes: number };
  /** Earliest bookable day is today + leadDays; latest is today + maxDaysAhead. */
  leadDays: number;
  maxDaysAhead: number;
  slotCapacity: number;
  purposes: string[];
  version: number;
  updatedAt: string;
};

export const HQ_CONTENT_KEY = 'content:hq';

// Initial content from docs/PROJECT_BRIEF.md section 5.3 and vcmem.com/location. Hours are a
// working assumption (Sunday to Thursday, 10:00 to 17:00) until the owner sets them from the dashboard.
export const HQ_SEED: HqContent = {
  title: 'مقر النادي',
  intro: 'مقر نادي المستثمرين في الرياض: 400 م² من المكاتب وقاعات الاجتماعات ومسرح النادي وكوفي شوب، للأعضاء المشتركين بالحجز المسبق.',
  address: 'الرياض، حي العليا، شارع الأمير محمد بن عبدالعزيز (التحلية سابقًا)، برج الجوهرة',
  mapUrl: 'https://maps.app.goo.gl/A8JZpNt5AgzC33m56',
  tourVideoId: 'XERenNWNziA',
  facilities: ['15 مكتبًا مجهزًا', 'مسرح النادي ومنصة العرض', 'قاعة اجتماعات لثمانية أشخاص مع Zoom', 'كوفي شوب'],
  rules: [
    'الدخول للأعضاء المشتركين فقط وبالحجز المسبق، ولا تُستقبل زيارات بدون موعد.',
    'بعد تأكيد الإدارة يصلك باركود دخول صالح لموعدك فقط.',
    'أحضر بطاقة عضويتك الرقمية من التطبيق عند الوصول.',
  ],
  memberOnlyText: 'حجز زيارة المقر متاح للأعضاء المشتركين. فعّل عضويتك السنوية لحجز موعدك.',
  guestText: 'سجّل الدخول بحسابك وفعّل عضويتك السنوية لحجز زيارة المقر.',
  hours: { days: [0, 1, 2, 3, 4], open: '10:00', close: '17:00', slotMinutes: 60 },
  leadDays: 1,
  maxDaysAhead: 30,
  slotCapacity: 5,
  purposes: ['اجتماع عمل', 'زيارة تعريفية للمقر', 'تصوير أو بودكاست', 'حضور فعالية', 'أخرى'],
  version: 1,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

export async function ensureHqSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<HqContent>(HQ_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= HQ_SEED.version) return false;
  await kv.set(HQ_CONTENT_KEY, HQ_SEED);
  return true;
}

export async function getHqContent(kv: KV): Promise<HqContent> {
  return (await kv.get<HqContent>(HQ_CONTENT_KEY)) ?? HQ_SEED;
}
