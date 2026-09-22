import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { MEMBERSHIP_EN } from './en/membership.js';

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

// The owner's membership page wording of 2026-09-20. The web price block and every pay link of that page stay on the
// web (CLAUDE.md rule 3): the app shows the store's own price at purchase time.
const GROUPS: MembershipGroup[] = [
  {
    key: 'why',
    title: 'لماذا تستحقها حتى قبل أن تحدّد وجهتك؟',
    icon: 'star',
    comingSoon: false,
    items: [
      item('عام كامل من ورش العمل والملتقيات والاستشارة بدون رسوم إضافية، تتعلّم فيه قبل أن تضع ريالًا في أي مشروع'),
      item('رصيد بنك المشاريع وحده 2,500 ريال، ويفتح لك 5 مشاريع حقيقية كاملة', { type: 'route', path: '/projects' }),
      item('وحين تحدّد وجهتك، تجد المسرح وتصميم موقعك وتطبيقك وخدمات المنظومة بنصف القيمة', { type: 'route', path: '/services' }),
      item('دخول مقر النادي بالرياض وحضور ملتقياته للأعضاء المشتركين فقط', { type: 'route', path: '/hq' }),
    ],
  },
  {
    key: 'learn',
    title: 'تعلّم وتعرّف قبل أن تقرر',
    icon: 'people',
    comingSoon: false,
    items: [
      item('كل ورش العمل والملتقيات الدورية مفتوحة لك: تتعلّم فيها من أصحاب التجربة، في مقر النادي بالرياض أو عبر الإنترنت، ومنها ملتقى «5 دقائق»'),
      item('دخول مقر النادي بالرياض: تلتقي فيه بأهل الخبرة وجهًا لوجه، وباركود دخولك يُصدر بعد حجز موعدك', { type: 'route', path: '/hq' }),
      item('الانضمام إلى قروبات النادي: تجمعك بالمستثمرين ورواد الأعمال، فتسمع تجاربهم وتسأل قبل أن تقرّر', { type: 'route', path: '/service/groups' }),
      item('مسيرتك تُروى في «شخصية ومسيرة»: لأن لكل شخص قصة ولكل مسيرة قيمة، ولو قبل مشروعك الأول — بدون رسوم', { type: 'route', path: '/service/famous' }),
      item('كل مزايا تطبيق نادي المستثمرين: مشمولة في عضويتك دون استثناء'),
      item('حساب واحد لكل مواقع المنظومة'),
    ],
  },
  {
    key: 'discover',
    title: 'تكتشف وجهتك من داخل المشاريع',
    icon: 'briefcase',
    comingSoon: false,
    items: [
      item('رصيد 2,500 ريال في بنك المشاريع: يفتح لك 5 مشاريع حقيقية كاملة تنتقيها بنفسك، فترى الفرص من الداخل', { type: 'route', path: '/projects' }),
      item('مشاريع البنك بين يديك: تصفّحها وتواصل مباشرةً مع مؤسسيها؛ فقد تجد وجهتك شريكًا في أحدها', { type: 'route', path: '/projects' }),
      item('خبراء النادي في متناولك: استشارة أونلاين بدون رسوم تسألهم فيها: من أين أبدأ؟', { type: 'route', path: '/service/consultation' }),
      item('مساعدك الذكي على مدار الساعة: رصيد يومي متجدد تسأله فيه عن أي فكرة أو مصطلح أو مشروع', { type: 'route', path: '/advisor' }),
    ],
  },
  {
    key: 'start',
    title: 'حين تبدأ مشروعك الأول',
    icon: 'rocket',
    comingSoon: false,
    items: [
      item('مشروعك الأول وكل ما بعده في «شركاء النجاح»: بلا حدّ لعدد مشاريعك ما دمت مؤسسها وعضويتك سارية، وتُنشر خلال 3 أيام كحد أقصى', { type: 'route', path: '/service/success-partners' }),
      item('أولوية عرض مشروعك على المستثمرين داخل بنك المشاريع'),
      item('نشر مشروعك 3 مرات شهريًا لكافة الأعضاء عبر تطبيق نادي المستثمرين', { type: 'route', path: '/service/repost' }),
    ],
  },
  {
    key: 'discounts',
    title: 'امتيازات تنطلق بها بأسعار الأعضاء',
    icon: 'pricetag',
    comingSoon: false,
    items: [
      item('مسرح النادي منصتك إلى العالم: أقِم ملتقاك الخاص على مسرح يتسع حتى 80 شخصًا، بتغطية إعلامية كاملة وبث مباشر إلى جميع أنحاء العالم، بخصم 50%', { type: 'route', path: '/service/theater' }),
      item('قاعة الاجتماعات بخصم 50%: لأول لقاء مع شريكك المحتمل، ولكل جلسة عمل بعده', { type: 'route', path: '/service/theater' }),
      item('تصوير خارجي وتغطية إعلامية لمؤتمراتك بخصم يصل إلى 50%'),
      item('موقعك وتطبيقك بنصف القيمة: تصميم أي موقع إلكتروني أو تطبيق جوال خاص بك، على Android أو iOS'),
      item('الأولوية لك في خدمات المنظومة، وبخصم 50%: اصنع ملتقاك، Pitch Deck، مومنتوم، بودكاست الملتقى، حقائب الامتياز', { type: 'route', path: '/services' }),
      item('كود خصم حتى 20% على منتجات «منفذ»', { type: 'route', path: '/service/manfaz' }),
    ],
  },
  {
    key: 'upcoming',
    title: 'خصومات قادمة تُضاف إلى عضويتك تلقائيًا',
    icon: 'time',
    comingSoon: true,
    items: [
      item('خصومات شركة وديني القابضة: النقل والشحن والسفر في تطبيق واحد'),
      item('خصومات تطبيق سكة: النقل المدرسي التشاركي لأبنائك'),
      item('مزايا وديني سكاي: مقاعد الطيران الخاص'),
      item('أسعار خاصة في مساحات PV: مساحات ومكاتب العمل داخل المنظومة، حين تحتاج مكتبك الأول'),
    ],
  },
];

/** Flat view of the groups for app versions that predate the grouped layout: one row per benefit line. */
function flatBenefits(groups: MembershipGroup[]): MembershipBenefit[] {
  return groups.filter((group) => !group.comingSoon).flatMap((group) => group.items.map((entry) => ({ icon: group.icon, title: entry.text, detail: null })));
}

// Content from docs/PROJECT_BRIEF.md section 4.1, reworded by the owner's membership page of 2026-09-20. The dashboard edits it later.
export const MEMBERSHIP_SEED: MembershipContent = {
  title: 'العضوية السنوية لنادي المستثمرين',
  subtitle: 'لم تحدّد وجهتك بعد؟ هذه العضوية صُمّمت لك أنت أولًا',
  intro: [
    'تجمع عضوية نادي المستثمرين المحايدين ورواد الأعمال والمستثمرين عبر تطبيق نادي المستثمرين®، المصمم خصيصًا لهذه الفئات الثلاث لبناء علاقات متبادلة، وطرح فرص شراكات نوعية، وإحداث تفاعل حقيقي بينهم من خلال ملتقيات وأمسيات وورش عمل دورية، تُقام حضوريًا في مقر النادي بالرياض، وعبر الإنترنت للأعضاء من خارج الرياض.',
    'تمنحك العضوية السنوية كمحايد فرصة الاحتكاك والتعلّم، وبناء العلاقات، واستكشاف عالم ريادة الأعمال والاستثمار، والتعرّف على فرص الشراكة عن قرب. فإذا كنت لا تزال تبحث عن المسار الأنسب لك، فهذه فرصتك لتكون جزءًا من منظومة تضم رواد أعمال ومستثمرين سبقوك بالانضمام.',
    'عام كامل تكتشف فيه وجهتك — بوابتك إلى عالم الأعمال. العضوية السنوية لا تمنحك مجرد حضور، بل تمنحك عامًا كاملًا لصناعة علاقات، واكتشاف فرص، وبناء شراكات تتحول إلى خطوات ونتائج واقعية.',
  ].join('\n\n'),
  groups: GROUPS,
  benefits: flatBenefits(GROUPS),
  comingSoonTitle: 'خصومات قادمة تُضاف إلى عضويتك تلقائيًا',
  comingSoon: ['خصومات وديني القابضة', 'تطبيق سكة', 'وديني سكاي', 'مساحات PV'],
  statusTexts: {
    guest: 'سجّل الدخول أو أنشئ حسابك لعرض حالة عضويتك.',
    unactivated: 'عضويتك غير مفعّلة، برجاء تفعيل عضويتك.',
    active: 'عضويتك فعّالة.',
    expired: 'انتهت عضويتك، برجاء تجديد عضويتك.',
  },
  activationNote: 'الاشتراك في العضوية السنوية من داخل التطبيق يتوفر مع الإصدار القادم عبر متجر التطبيقات.',
  version: 4,
  updatedAt: '2026-09-20T00:00:00.000Z',
};

/** Writes the seed when no membership content exists yet, or when the stored seed is older than this one. */
export async function ensureMembershipSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= MEMBERSHIP_SEED.version) return false;
  await kv.set(MEMBERSHIP_CONTENT_KEY, MEMBERSHIP_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getMembershipContent(kv: KV, lang: AppLang = 'ar'): Promise<MembershipContent> {
  return localizeBlock(kv, 'membership', (await kv.get<MembershipContent>(MEMBERSHIP_CONTENT_KEY)) ?? MEMBERSHIP_SEED, MEMBERSHIP_EN, lang);
}
