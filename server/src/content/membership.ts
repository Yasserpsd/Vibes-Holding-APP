import type { KV } from '../store.js';
import { STUDIO_WHATSAPP } from './services.js';

/**
 * Membership screen content: benefit groups and status wording. Editable server content
 * (no prices: the store price comes later). `benefits` and `comingSoon` are kept flat for
 * app versions older than M6.
 */
export type MembershipBenefit = {
  icon: string;
  title: string;
  detail: string | null;
};

export type MembershipItemLink = { type: 'whatsapp'; phone: string; message: string } | { type: 'route'; path: string };

export type MembershipItem = { text: string; link: MembershipItemLink | null };

export type MembershipGroup = {
  key: string;
  title: string;
  icon: string;
  /** «قريبًا» groups list benefits that join the membership automatically once available. */
  comingSoon: boolean;
  items: MembershipItem[];
};

export type MembershipContent = {
  title: string;
  subtitle: string;
  intro: string;
  groups: MembershipGroup[];
  benefits: MembershipBenefit[];
  comingSoonTitle: string;
  comingSoon: string[];
  statusTexts: {
    guest: string;
    unactivated: string;
    active: string;
    expired: string;
  };
  activationNote: string;
  version: number;
  updatedAt: string;
};

export const MEMBERSHIP_CONTENT_KEY = 'content:membership';

const item = (text: string, link: MembershipItemLink | null = null): MembershipItem => ({ text, link });

const GROUPS: MembershipGroup[] = [
  {
    key: 'bank',
    title: 'بنك المشاريع',
    icon: 'briefcase',
    comingSoon: false,
    items: [
      item('رصيد 3,750 ريال في بنك المشاريع يعادل 5 مشاريع كاملة تختارها بنفسك', { type: 'route', path: '/projects' }),
      item('أولوية عرض مشروعك على المستثمرين في بنك المشاريع خلال 3 أيام كحد أقصى'),
      item('نشر مشروعك على منصات النادي 3 مرات شهريًا على القروبات والمنصات والتطبيق'),
      item('التقديم على شركاء النجاح بأولوية', { type: 'route', path: '/service/success-partners' }),
      item('تصفّح كل مشاريع بنك المشاريع', { type: 'route', path: '/projects' }),
      item('التواصل المباشر مع مؤسسي المشاريع'),
    ],
  },
  {
    key: 'presence',
    title: 'حضورك وأدواتك',
    icon: 'people',
    comingSoon: false,
    items: [
      item('أولوية الحضور في ملتقيات النادي وملتقى «5 دقائق» — حضوريًا في الرياض أو عبر الإنترنت'),
      item('دخول مقر النادي بالرياض (باركود الدخول يُصدر للأعضاء المشتركين بعد حجز الموعد)', { type: 'route', path: '/hq' }),
      item('استشارة أونلاين مع خبراء النادي بدون رسوم', { type: 'route', path: '/service/consultation' }),
      item('مساعد الذكاء الاصطناعي برصيد يومي متجدد على مدار الساعة', { type: 'route', path: '/advisor' }),
      item('ظهورك في «شخصية ومسيرة» بدون رسوم', { type: 'route', path: '/service/famous' }),
      item('الانضمام إلى قروبات النادي', { type: 'route', path: '/service/groups' }),
      item('حساب واحد لكل مواقع المنظومة'),
      item('حجز الاستديو (بودكاست الملتقى) للأعضاء المشتركين عبر واتساب الاستديو', {
        type: 'whatsapp',
        phone: STUDIO_WHATSAPP,
        message: 'أرغب في حجز استديو بودكاست الملتقى.',
      }),
    ],
  },
  {
    key: 'discounts',
    title: 'خصومات المنظومة',
    icon: 'pricetag',
    comingSoon: false,
    items: [
      item('خصم 50% على مسرح النادي وقاعة الاجتماعات', { type: 'route', path: '/service/theater' }),
      item('خصم 50% على خدمات المنظومة (اصنع ملتقاك، Pitch Deck، مومنتوم، بودكاست الملتقى، حقائب الامتياز)', { type: 'route', path: '/services' }),
      item('كود خصم حتى 20% على منتجات «منفذ»', { type: 'route', path: '/service/manfaz' }),
    ],
  },
  {
    key: 'upcoming',
    title: 'خصومات قادمة تُضاف لعضويتك تلقائيًا',
    icon: 'time',
    comingSoon: true,
    items: [
      item('خصومات شركة وديني القابضة (النقل والشحن والسفر في تطبيق واحد)'),
      item('خصومات تطبيق سكة (النقل المدرسي التشاركي)'),
      item('مزايا وديني سكاي (مقاعد الطيران الخاص)'),
      item('أسعار خاصة في مساحات PV (مساحات ومكاتب العمل داخل المنظومة)'),
    ],
  },
];

/** Flat view of the groups for app versions that predate the grouped layout: one row per benefit line. */
function flatBenefits(groups: MembershipGroup[]): MembershipBenefit[] {
  return groups.filter((group) => !group.comingSoon).flatMap((group) => group.items.map((entry) => ({ icon: group.icon, title: entry.text, detail: null })));
}

// Content from docs/PROJECT_BRIEF.md section 4.1 (the owner's wording, 2026-09-12). The dashboard edits it later.
export const MEMBERSHIP_SEED: MembershipContent = {
  title: 'العضوية الذهبية',
  subtitle: 'العضوية السنوية لنادي المستثمرين',
  intro: 'عضوية واحدة تفتح كل مزايا النادي لعام كامل: بنك المشاريع، الملتقيات والمقر، المستشار الذكي، وخصومات المنظومة.',
  groups: GROUPS,
  benefits: flatBenefits(GROUPS),
  comingSoonTitle: 'خصومات قادمة تُضاف لعضويتك تلقائيًا',
  comingSoon: ['خصومات وديني القابضة', 'تطبيق سكة', 'وديني سكاي', 'مساحات PV'],
  statusTexts: {
    guest: 'سجّل الدخول أو أنشئ حسابك لعرض حالة عضويتك.',
    unactivated: 'عضويتك غير مفعّلة، برجاء تفعيل عضويتك.',
    active: 'عضويتك فعّالة.',
    expired: 'انتهت عضويتك، برجاء تجديد عضويتك.',
  },
  activationNote: 'تفعيل العضوية من داخل التطبيق يتوفر قريبًا.',
  version: 2,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

/** Writes the seed when no membership content exists yet, or when the stored seed is older than this one. */
export async function ensureMembershipSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= MEMBERSHIP_SEED.version) return false;
  await kv.set(MEMBERSHIP_CONTENT_KEY, MEMBERSHIP_SEED);
  return true;
}

export async function getMembershipContent(kv: KV): Promise<MembershipContent> {
  return (await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY)) ?? MEMBERSHIP_SEED;
}
