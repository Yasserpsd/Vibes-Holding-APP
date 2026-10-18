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

/** M99d: one of the neutral's ten reasons; `badges` render as gold pills beside the title. */
export type NeutralReason = { title: string; text: string; badges?: string[] };

export type MembershipContent = {
  title: string;
  subtitle: string;
  intro: string;
  groups: MembershipGroup[];
  benefits: MembershipBenefit[];
  /** M99d: the neutral persona's own benefits copy (the owner's 10-reason page); other personas keep `groups`. */
  neutralReasons?: { title: string; intro: string; items: NeutralReason[] };
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

// The owner's membership page wording, last synced with his 2026-10-16 paste (the «لم تحدّد وجهتك
// بعد» worldwide direction, in-person + online, dollar equivalents on the bank balance).
// The web price block (1,900 / 3,900 and their $ values) and every pay link of that page stay on
// the web (CLAUDE.md rule 3): the app shows the store's own price at purchase time.
// NOTE: the page no longer lists the «شركاؤنا» promo-code line, but the app KEEPS it — the
// owner confirmed (2026-10-16): «سيبه — برنامج شركاؤنا شغال في الأبليكشن».
const GROUPS: MembershipGroup[] = [
  {
    key: 'why',
    title: 'لماذا تستحقها حتى قبل أن تحدّد وجهتك؟',
    icon: 'star',
    comingSoon: false,
    items: [
      item('عام كامل من الملتقيات المشمولة بعضويتك، واستشارة أونلاين مع مستشار ذكي بدون رسوم إضافية، تتعلّم فيه قبل أن تضع ريالًا في أي مشروع'),
      // ‎ keeps the Latin ($667) reading left-to-right inside the Arabic sentence.
      item('رصيد بنك المشاريع وحده 2,500 ريال ‎($667)‎ — أكثر من قيمة اشتراكك نفسه — ويفتح لك التفاصيل الكاملة لـ5 مشاريع', { type: 'route', path: '/projects' }),
      item('وحين تحدّد وجهتك، تجد المسرح وتصميم موقعك وتطبيقك وخدمات المنظومة بخصم 50%', { type: 'route', path: '/services' }),
      item('دخول مقر النادي بالرياض وحضور ملتقياته للأعضاء المشتركين فقط', { type: 'route', path: '/hq' }),
    ],
  },
  {
    key: 'network',
    title: 'العلاقات هي رأس مالك الحقيقي',
    icon: 'people',
    comingSoon: false,
    items: [
      item('بوابتك إلى السوق السعودي أينما كنت: سواء كنت في الرياض أو طوكيو أو جنيف أو نيويورك أو دبي أو القاهرة، عضويتك تضعك داخل مجتمع أعمال سعودي قائم، قبل أن تصل وبعد أن تصل'),
      item('عام كامل لبناء علاقات تدوم: ملتقيات وأمسيات وورش عمل على مدار السنة، تمنحك وقتًا كافيًا لتتعرّف وتبني الثقة وتطوّر علاقاتك المهنية', { type: 'route', path: '/agenda' }),
      item('مجتمع يجمع المحايدين ورواد الأعمال والمستثمرين: وسّع شبكة معارفك، واطّلع على تجارب ومسارات متنوعة من داخل المملكة وخارجها'),
      item('فرص متجددة للقاء والتعلّم طوال العام: حضور ملتقيات النادي وورش العمل والأمسيات الخاصة بدون رسوم', { type: 'route', path: '/agenda' }),
      item('منصة لعرض مشروعك أمام المهتمين بفرص الشراكة: أيام مخصصة لرواد الأعمال، وأولوية في حجز مشاركتك بملتقى «5 دقائق» لعرض مشروعك مباشرة'),
    ],
  },
  {
    key: 'hq',
    title: 'مقر دائم وتطبيق في تجربة واحدة',
    icon: 'business',
    comingSoon: false,
    items: [
      item('مقر النادي في قلب الرياض — العليا، شارع الأمير محمد بن عبدالعزيز — ويكمّله تطبيق يرافقك أينما كنت', { type: 'route', path: '/hq' }),
      item('مقر مجهّز للقاءات والفعاليات: 400 متر مربع تضم 15 مكتبًا، ومنصة ومسرحًا يتسع لـ80 شخصًا', { type: 'route', path: '/hq' }),
      item('حاضر معنا حتى لو كنت خارج السعودية: فعاليات تُقام في المقر وتُبث عبر الإنترنت للأعضاء في كل مكان، داخل المملكة وخارجها'),
    ],
  },
  {
    key: 'bank',
    title: 'حاضنة أعمال وبنك مشاريع يضم أكثر من 260 مشروعًا',
    icon: 'briefcase',
    comingSoon: false,
    items: [
      item('قدّم مشروعك للنظر في إدراجه، واستعرض المشاريع التي اجتازت الفحص والتقييم', { type: 'route', path: '/projects' }),
      item('رصيد بقيمة 2,500 ريال ‎($667)‎ في بنك المشاريع: اطّلع على التفاصيل الكاملة لخمسة مشاريع تختارها، وتواصل مباشرةً مع مؤسسيها لمناقشة فرص الشراكة', { type: 'route', path: '/projects' }),
      item('تقييم مشروعك خلال 10 أيام عمل: بعد استيفاء معايير القبول يُحال إلى بنك المشاريع ويُعرض على أعضاء النادي', { type: 'route', path: '/service/success-partners' }),
      item('ظهور متجدد لمشروعك طوال العام: إعادة إبراز مشروعك مرة كل شهر لكافة أعضاء النادي', { type: 'route', path: '/service/repost' }),
    ],
  },
  {
    key: 'neutral',
    title: 'محايد ولم تحدّد وجهتك بعد؟ مكانك معنا',
    icon: 'compass',
    comingSoon: false,
    items: [
      item('استكشف ريادة الأعمال وفرص الشراكة، واكتشف اهتماماتك قبل أن تختار مسارك', { type: 'route', path: '/guide' }),
      item('استشارة أونلاين بدون رسوم إضافية: مع مستشار ذكي مدعوم بالذكاء الاصطناعي، يساعدك على فهم فكرتك وتحديد خطواتك التالية', { type: 'route', path: '/service/consultation' }),
      item('مساعد ذكي على مدار الساعة: برصيد استخدام يومي متجدد، للاستفسارات والصياغة والتحليل والتعرّف على خدمات المنظومة', { type: 'route', path: '/advisor' }),
      item('كل مزايا التطبيق مشمولة بعضويتك: تابع المشاريع والفعاليات والإشعارات بحساب واحد'),
      item('قدّم نفسك وخبراتك للأعضاء عبر مبادرة «شخصية ومسيرة» بدون رسوم، ضمن الشخصيات التي تختارها لجنة النادي دوريًّا', { type: 'route', path: '/service/famous' }),
    ],
  },
  {
    key: 'discounts',
    title: 'امتيازات تنطلق بها بأسعار الأعضاء',
    icon: 'pricetag',
    comingSoon: false,
    items: [
      item('أقم ملتقاك الخاص بخصم 50%: عبر خدمة «اصنع ملتقاك» وتأجير مسرح النادي، مع تغطية إعلامية وبث مباشر لفعاليتك', { type: 'route', path: '/service/meetup' }),
      item('غرفة اجتماعات بنصف القيمة: تتسع لـ8 أشخاص ومجهّزة باشتراك Zoom، لاجتماعاتك ولقاءات شركائك', { type: 'route', path: '/service/theater' }),
      item('صمّم موقعك أو تطبيقك بخصم 50%: تصميم المواقع الإلكترونية وتطبيقات الجوال على Android وiOS', { type: 'route', path: '/service/momentum' }),
      item('جهّز عرض مشروعك بخصم 50%: إعداد العرض التقديمي «Pitch Deck» عبر شركة PV', { type: 'route', path: '/service/pitch-deck' }),
      item('خدمات تسويقية بخصم 50% عبر مومنتوم: الهوية البصرية، وإدارة المحتوى، والحملات الرقمية، وباقات إعلانات المؤثرين', { type: 'route', path: '/service/momentum' }),
      item('استوديو بودكاست مجهّز بالكامل، مع خصم 50% على خدمات بودكاست الملتقى لتسجيل الحلقات وإنتاج المحتوى المرئي', { type: 'route', path: '/service/studio' }),
      item('برومو كود باسمك لدى «شركائنا»: كود واحد خاص بعضويتك يفتح لك خصومات شركاء النادي فورًا', { type: 'route', path: '/partners' }),
    ],
  },
  {
    key: 'upcoming',
    title: 'مزايا وخصومات قادمة تُضاف تلقائيًا لعضويتك',
    icon: 'time',
    comingSoon: true,
    items: [item('جارٍ ربط جهات عديدة لتقديم خصومات متنوعة خصيصًا لأعضاء النادي، تُضاف إلى عضويتك تلقائيًا')],
  },
];

/** Flat view of the groups for app versions that predate the grouped layout: one row per benefit line. */
function flatBenefits(groups: MembershipGroup[]): MembershipBenefit[] {
  return groups.filter((group) => !group.comingSoon).flatMap((group) => group.items.map((entry) => ({ icon: group.icon, title: entry.text, detail: null })));
}

// The owner's membership page of 2026-10-14 (vcmem.com): worldwide membership, the Riyadh HQ as the
// member's second home, and the «لم تحدّد وجهتك بعد» framing. The dashboard edits it later.
export const MEMBERSHIP_SEED: MembershipContent = {
  title: 'العضوية السنوية لنادي المستثمرين',
  subtitle: 'لم تحدّد وجهتك بعد؟ هذه العضوية صُمّمت لك أنت أولًا',
  intro: [
    'نادي المستثمرين® مجتمع أعمال حصري للمحايدين ورواد الأعمال والمستثمرين، يقدّم خدماته لأعضائه عبر تطبيق واحد ومقر دائم في قلب العاصمة السعودية الرياض.',
    'من السعودية إلى العالم… عضويتك معك أينما كنت؛ فلديك عام كامل تستفيد فيه من جميع مزايا النادي، حضوريًا في مقر النادي بمدينة الرياض بالمملكة العربية السعودية وعبر الإنترنت، وتستكشف المشاريع وفرص الشراكة، لتبني علاقات قد تفتح لك أبوابًا لا يفتحها المال وحده.',
    'وحين تصل إلى الرياض، فالنادي بيتك الثاني في عالم الأعمال: قاعة اجتماعات لاستقبال ضيوفك، ومقر مجهّز يتسع لـ80 شخصًا مع منصة متكاملة لاستضافة ملتقياتك وورش عملك الخاصة، و15 مكتبًا للاستخدام المؤقت، واستوديو بودكاست لتصل رسالتك، وحاضنة أعمال تحتضن مشروعك — كلها متاحة لك بصفتك عضوًا، مع خصومات تخفّف تكاليف أعمالك.',
    'عام كامل تكتشف فيه وجهتك — بوابتك إلى عالم الأعمال. العضوية السنوية لا تمنحك مجرد حضور، بل تمنحك عامًا كاملًا لصناعة علاقات، واكتشاف فرص، وبناء شراكات تتحول إلى خطوات ونتائج واقعية.',
  ].join('\n\n'),
  groups: GROUPS,
  benefits: flatBenefits(GROUPS),
  // M99d: the owner's 10-reason page (docs/neutral-benefits-copy-2026-10-18.md, verbatim; brand per M71).
  neutralReasons: {
    title: 'لماذا تشترك في عضوية نادي المستثمرين وأنت لم تحدّد وجهتك بعد؟',
    intro:
      'لست مضطرًا أن تكون مستثمرًا ولا صاحب مشروع لتنضم؛ موظفًا كنت أو طالبًا أو صاحب مدخرات تبحث عن طريقك، يضعك اشتراك واحد لعام كامل داخل مجتمع أعمال مغلق ومحكوم يجمع آلاف المحايدين ورواد الأعمال والمستثمرين، ويفتح لك أبواب شركات منظومة Vibes Ventures بخصومات خاصة بالأعضاء. هذه هي الأسباب باختصار:',
    items: [
      {
        title: 'هنا مكانك قبل أن تختار طريقك',
        text: 'المحايدون هم الفئة الأكبر عددًا داخل النادي: تحضر الورش والملتقيات، وتتصفح المشاريع برصيدك، وتستشير مستشارك الخبير بالذكاء الاصطناعي، وتبني علاقاتك — عامًا كاملًا قبل أن تقرر إن كنت ستبدأ مشروعًا أو تشارك في مشروع غيرك.',
      },
      {
        title: 'تتعلّم عالم الاستثمار من الداخل',
        text: 'ترى كيف تُقيَّم المشاريع، وكيف يفكر المستثمر، وكيف تُبنى الشراكات على أرض الواقع… من أصحاب تجارب حقيقية لا من النظريات، قبل أن تضع ريالًا واحدًا في أي مشروع.',
      },
      {
        title: 'كل ورش العمل والملتقيات مفتوحة لك',
        text: 'تحضر جميع ورش العمل والملتقيات الدورية في مقر النادي بالرياض، أو تتابع الملتقيات عن بُعد إن كنت خارجها؛ تسمع وتسأل وتتعلّم، وحين يولد مشروعك تعرضه أمام المستثمرين في ملتقى «5 دقائق».',
      },
      {
        title: 'شبكة علاقات جاهزة من اليوم الأول',
        text: 'تنضم إلى مجتمع النادي الذي يجمع آلاف المحايدين ورواد الأعمال والمستثمرين، بحساب واحد لكل مواقع المنظومة… وعلاقة واحدة قد تكون بداية طريقك.',
      },
      {
        title: 'تكتشف وجهتك من مشاريع حقيقية',
        text: 'مشاريع مُقيَّمة مسبقًا تُعرض داخل النادي طوال العام، ورصيد 2,500 ريال في بنك المشاريع يفتح لك 5 مشاريع كاملة تنتقيها بما يناسب مجالك وإمكاناتك، ثم تلتقي بمؤسسيها مباشرة… وقد تجد وجهتك شريكًا في أحدها.',
      },
      {
        title: 'مستشار خبير بالذكاء الاصطناعي في جيبك',
        text: 'تسأله في استشارة أونلاين بدون رسوم: من أين أبدأ؟ مستشار خبير بالذكاء الاصطناعي، قائم على تقنية خاصة بـ Vibes Ventures محمية ببراءة اختراع، ويعمل على سيرفرات Vibes Ventures الخاصة؛ يقرأ وضعك وأرقامك ويضع أمامك خطوتك التالية بوضوح. ومعك رصيد يومي متجدد لدى مساعد الذكاء الاصطناعي على مدار الساعة، وكل مزايا تطبيق نادي المستثمرين.',
        badges: ['براءة اختراع', 'على سيرفرات Vibes Ventures الخاصة'],
      },
      {
        title: 'ظهورك في مبادرة «شخصية ومسيرة»',
        text: 'لأن لكل شخص قصة ولكل مسيرة قيمة، يُنشر ملفك ومسيرتك المهنية على منصات النادي وأمام جمهوره بدون رسوم، ولو قبل مشروعك الأول، ضمن الشخصيات التي تُختار دوريًا من الأعضاء.',
      },
      {
        title: 'مشروعك الأول وكل ما بعده أمام المستثمرين',
        text: 'حين تبدأ، تضيف أي عدد من مشاريعك في برنامج «شركاء النجاح» ما دمت مؤسسها وعضويتك سارية، مع أولوية في تقييم مشروعك خلال 10 أيام عمل، ثم يُرحَّل إلى بنك المشاريع ليكون متاحًا للعرض على جميع أعضاء النادي، مع نشر مشروعك 3 مرات شهريًا على منصات النادي.',
      },
      {
        title: 'مسرح النادي منصتك إلى العالم',
        text: 'حين تريد أن تشارك فكرتك أو خبرتك، تقيم ملتقاك الخاص على مسرح يتسع حتى 80 شخصًا، بتغطية إعلامية كاملة وبث مباشر إلى جميع أنحاء العالم، وكل ذلك بخصم 50٪.',
        badges: ['مباشر'],
      },
      {
        title: 'خدماتك بالأولوية وبنصف القيمة',
        text: 'وحين تتحوّل فكرتك إلى مشروع: تصميم أي موقع إلكتروني أو تطبيق جوال خاص بك على Android أو iOS، وملخص الجدوى (Pitch Deck)، والتسويق من مومنتوم، وإنتاج بودكاست الملتقى، وحقيبة الامتياز التجاري، وقاعة الاجتماعات — بخصم 50٪، ومعها خصم يصل إلى 50٪ على التصوير الخارجي وتغطية مؤتمراتك، وكود يصل إلى 20٪ على منتجات «منفذ».',
      },
    ],
  },
  comingSoonTitle: 'مزايا وخصومات قادمة تُضاف تلقائيًا لعضويتك',
  comingSoon: ['جارٍ ربط جهات عديدة لتقديم خصومات متنوعة خصيصًا لأعضاء النادي'],
  statusTexts: {
    guest: 'سجّل الدخول أو أنشئ حسابك لعرض حالة عضويتك.',
    unactivated: 'عضويتك غير مفعّلة، برجاء تفعيل عضويتك.',
    active: 'عضويتك فعّالة.',
    expired: 'انتهت عضويتك، برجاء تجديد عضويتك.',
  },
  activationNote: 'الاشتراك في العضوية السنوية من داخل التطبيق يتوفر مع الإصدار القادم عبر متجر التطبيقات.',
  version: 7,
  updatedAt: '2026-10-18T00:00:00.000Z',
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
