import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { HQ_EN } from './en/hq.js';

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
  /** M109a: every member's ANNUAL wallet of bookable office/meeting-room hours. */
  walletHours: number;
  version: number;
  updatedAt: string;
};

export const HQ_CONTENT_KEY = 'content:hq';

// Initial content from docs/PROJECT_BRIEF.md section 5.3 and vcmem.com/location. Hours are a
// the owner's hours (2026-09-12): Sunday to Thursday, 10:00 to 19:00; the dashboard edits them later.
export const HQ_SEED: HqContent = {
  title: 'مقر النادي',
  // M82: the owner's supporting HQ copy (2026-10-17), used as written.
  intro:
    'وحين تصل إلى الرياض، فالنادي بيتك الثاني في عالم الأعمال، ولا داعي لأن تحمل همّ متطلبات عملك الأساسية؛ فقد وفّرنا لك قاعة اجتماعات لاستقبال ضيوفك، ومقرًّا مجهّزًا يتسع لـ80 شخصًا مع منصة متكاملة لاستضافة ملتقياتك وورش عملك الخاصة، و15 مكتبًا للاستخدام المؤقت، واستوديو بودكاست لتصل رسالتك، وحاضنة أعمال تحتضن مشروعك. كلها متاحة لك بصفتك عضوًا، مع خصومات تخفّف تكاليف أعمالك.',
  address: 'الرياض، حي العليا، شارع الأمير محمد بن عبدالعزيز (التحلية سابقًا)، برج الجوهرة',
  mapUrl: 'https://maps.app.goo.gl/A8JZpNt5AgzC33m56',
  tourVideoId: 'XERenNWNziA',
  facilities: ['15 مكتبًا مجهزًا', 'مسرح النادي ومنصة العرض', 'قاعة اجتماعات لثمانية أشخاص مع Zoom', 'كوفي شوب'],
  rules: [
    'الدخول للأعضاء المشتركين فقط وبالحجز المسبق، ولا تُستقبل زيارات بدون موعد.',
    'بعد تأكيد الإدارة يصلك باركود دخول صالح لموعدك فقط.',
    'أحضر بطاقة عضويتك الرقمية من التطبيق عند الوصول.',
  ],
  // M109f: the owner's upsell sentence on every member-only feature.
  memberOnlyText: 'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.',
  guestText: 'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.',
  // M109a (owner, 2026-10-20): the bookable day spans 12 hours — first slot 09:00, last slot 20:00.
  hours: { days: [0, 1, 2, 3, 4], open: '09:00', close: '21:00', slotMinutes: 60 },
  leadDays: 1,
  maxDaysAhead: 30,
  slotCapacity: 5,
  // M107 (owner, 2026-10-20): the meeting room books through this same flow, بدون رسوم for members.
  purposes: ['حجز قاعة الاجتماعات', 'اجتماع عمل', 'زيارة تعريفية للمقر', 'تصوير أو بودكاست', 'حضور فعالية', 'أخرى'],
  // M109a: 24 bookable office/meeting-room hours per member per membership year.
  walletHours: 24,
  // v5 (M109a+f): the 09:00–21:00 day, the hours wallet, and the upsell lock texts.
  version: 5,
  updatedAt: '2026-10-20T00:00:00.000Z',
};

export async function ensureHqSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<HqContent>(HQ_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= HQ_SEED.version) return false;
  await kv.set(HQ_CONTENT_KEY, HQ_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getHqContent(kv: KV, lang: AppLang = 'ar'): Promise<HqContent> {
  return localizeBlock(kv, 'hq', (await kv.get<HqContent>(HQ_CONTENT_KEY)) ?? HQ_SEED, HQ_EN, lang);
}
