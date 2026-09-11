import type { KV } from '../store.js';

/** Membership screen content: benefits and status wording. Editable server content (no prices: the store price comes later). */
export type MembershipBenefit = {
  icon: string;
  title: string;
  detail: string | null;
};

export type MembershipContent = {
  title: string;
  intro: string;
  benefits: MembershipBenefit[];
  comingSoon: string[];
  statusTexts: {
    guest: string;
    unactivated: string;
    active: string;
    expired: string;
  };
  activationNote: string;
  updatedAt: string;
};

export const MEMBERSHIP_CONTENT_KEY = 'content:membership';

// Initial content from docs/PROJECT_BRIEF.md section 4. The dashboard edits it later.
export const MEMBERSHIP_SEED: MembershipContent = {
  title: 'العضوية السنوية',
  intro: 'عضوية واحدة تفتح كل مزايا النادي لعام كامل: الشراكات، الخدمات، المستشار الذكي، ومقر النادي.',
  benefits: [
    {
      icon: 'megaphone',
      title: 'نشر مشروعك',
      detail: 'إعادة نشر مشروعك 3 مرات شهريًا على منصات النادي والتطبيق، وتخصيص لقاء «شخصية ومسيرة» لك.',
    },
    {
      icon: 'briefcase',
      title: 'رصيد بنك المشاريع',
      detail: 'رصيد بقيمة 3,750 ريال يعادل فتح بيانات 5 مشاريع من بنك المشاريع.',
    },
    {
      icon: 'sparkles',
      title: 'المستشار الذكي',
      detail: 'مستشارك الخاص بالذكاء الاصطناعي برصيد يومي متجدد على مدار الساعة.',
    },
    {
      icon: 'people',
      title: 'خبراء النادي',
      detail: 'استشارة أونلاين مع خبراء النادي بدون رسوم، وأولوية الحضور في الملتقيات وملتقى «5 دقائق».',
    },
    {
      icon: 'business',
      title: 'مقر النادي بالرياض',
      detail: 'دخول المقر بالحجز المسبق، ومسرح النادي (60 مقعدًا) وقاعة الاجتماعات (8 أشخاص مع Zoom) بخصم 50%.',
    },
    {
      icon: 'pricetag',
      title: 'خصم 50% على خدمات المنظومة',
      detail:
        'اصنع ملتقاك، Pitch Deck، باقات استوديو بودكاست الملتقى بلا حد للاستخدام، تصميم المواقع والتطبيقات من مومنتوم، باقات التسويق الإلكتروني، إعلانات المؤثرين، وحقيبة الامتياز.',
    },
    {
      icon: 'cart',
      title: 'منتجات «منفذ»',
      detail: 'خصم حتى 20% على منتجات «منفذ» من الصفقات السريعة للتجارة.',
    },
  ],
  comingSoon: ['خصومات وديني القابضة', 'تطبيق سكة', 'وديني سكاي', 'مساحات PV'],
  statusTexts: {
    guest: 'سجّل الدخول أو أنشئ حسابك لعرض حالة عضويتك.',
    unactivated: 'عضويتك غير مفعّلة، برجاء تفعيل عضويتك.',
    active: 'عضويتك فعّالة.',
    expired: 'انتهت عضويتك، برجاء تجديد عضويتك.',
  },
  activationNote: 'تفعيل العضوية من داخل التطبيق يتوفر قريبًا.',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

/** Writes the seed when no membership content exists yet. Returns true when it wrote. */
export async function ensureMembershipSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY);
  if (existing) return false;
  await kv.set(MEMBERSHIP_CONTENT_KEY, MEMBERSHIP_SEED);
  return true;
}

export async function getMembershipContent(kv: KV): Promise<MembershipContent> {
  return (await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY)) ?? MEMBERSHIP_SEED;
}
