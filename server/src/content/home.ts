import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { HOME_EN } from './en/home.js';

/**
 * Home screen content: the three portals, the golden and membership blocks and the advisor
 * opening for the neutral portal. Editable server content (the dashboard edits it later).
 */
export type PortalKey = 'neutral' | 'entrepreneur' | 'investor';

export type HomePortal = {
  key: PortalKey;
  title: string;
  subtitle: string;
  /** The same two lines for the English version of the app (owner's wording, 2026-09-21). */
  titleEn?: string;
  subtitleEn?: string;
  /** Icon family name known to the app; unknown names fall back to a generic icon. */
  icon: string;
  /** Where the portal leads: the Projects Bank, the entrepreneurs page, the advisor or the neutral's guide (M10). */
  target: 'projects' | 'entrepreneurs' | 'advisor' | 'guide';
};

/** M74: a persona-matched call to action on a home block — `route` is an app path (expo-router). */
export type HomeCta = { label: string; route: string };

/** M74: the home blocks the app can reorder per persona; unknown names are ignored by the app. */
export type HomeSectionKey =
  | 'famous'
  | 'posts'
  | 'agenda'
  | 'portals'
  | 'quickActions'
  | 'projectsBank'
  | 'golden'
  | 'membership'
  | 'services'
  | 'partners'
  | 'videos'
  | 'advisor'
  | 'podcast'
  | 'savings'
  | 'tour'
  | 'opportunity'
  | 'wallet';

/** M74: how the home reads for one persona (or a guest): its own copy, block order and block CTAs. */
export type HomePersonaVariant = {
  /** Replaces the hero subtitle so the opening line speaks to this persona. */
  heroSubtitle?: string;
  /** The block order for this persona; blocks left out keep the app's default order after the listed ones. */
  order?: HomeSectionKey[];
  /** Per-block CTA overrides (label + app route). */
  ctas?: Partial<Record<HomeSectionKey, HomeCta>>;
  /** M99: blocks this persona never sees, even when the default order carries them. */
  hide?: HomeSectionKey[];
  /** M99: tab routes this persona never sees (e.g. 'projects'); the screens stay reachable by path. */
  hideTabs?: string[];
  /** M99: the service keys that LEAD this persona's services grid; the rest follow in catalog order. */
  serviceKeys?: string[];
};

export type HomeContent = {
  /** `story` (M102, owner's verbatim text 2026-10-19): the paragraphs behind «اقرأ المزيد» under the hero. */
  hero: { eyebrow: string; title: string; subtitle: string; story?: string[] };
  portals: HomePortal[];
  golden: { title: string; subtitle: string; cta: string };
  membership: { title: string; subtitle: string; cta: string; activeText: string };
  services: { title: string; subtitle: string; cta: string };
  /** M68 «شركاؤنا»: the partners strip; an older stored block has no key and the app hides the strip. */
  partners?: { title: string; subtitle: string; cta: string };
  /** M73 «شخصية ومسيرة» (owner, 2026-10-16 second call: the section sits LOW on the home, not first); absent on an older stored block = hidden. */
  famous?: { title: string; subtitle: string; cta: string };
  videos: { title: string; subtitle: string; cta: string };
  /** M84: the Projects Bank home block with the auto-rotating image carousel; absent on an older stored block = hidden. */
  projectsBank?: { title: string; subtitle: string; cta: string };
  /** M74-8: the advisor-as-companion card (central to the neutral's journey); chips are next-step suggestions. */
  advisor?: { title: string; subtitle: string; cta: string; chips: HomeCta[] };
  /** M74-7: the featured podcast card — the studio as the member's stage to introduce himself. */
  podcast?: { title: string; subtitle: string; cta: string; route: string };
  /** M74-5: what the membership saves while he explores; the CTA leads to the membership screen. */
  savings?: { title: string; subtitle: string; items: string[]; cta: string };
  /** M99c «الفرصة الذهبية»: ONE featured project that changes on every app open — the investor's opening act. */
  opportunity?: { title: string; subtitle: string; cta: string };
  /** M99c: the investor's wallet card — his Projects Bank balance and unlocked projects at a glance. */
  wallet?: { title: string; subtitle: string; cta: string };
  /** M74: per-persona home variants (guest included). Absent on an older stored block = one home for everyone. */
  personas?: Partial<Record<PortalKey | 'guest', HomePersonaVariant>>;
  /** The entrepreneurs portal page: intro plus the keys of the services it lists. */
  entrepreneurs: { title: string; intro: string; serviceKeys: string[] };
  /** The advisor opens the conversation itself when a visitor arrives from the neutral portal. */
  neutralOpening: { title: string; text: string; quickReplies: string[] };
  version: number;
  updatedAt: string;
};

export const HOME_CONTENT_KEY = 'content:home';

// Initial content from the owner's requirements (docs/PROJECT_BRIEF.md, M6). The dashboard edits it later.
export const HOME_SEED: HomeContent = {
  hero: {
    eyebrow: 'نادي المستثمرين',
    title: 'مجتمع راقٍ يؤمن بأن الفكر ثروة',
    // M82 (owner, 2026-10-17): the CANONICAL definition leads the home — verbatim first paragraph.
    subtitle:
      'نادي المستثمرين® مجتمع أعمال حصري للمحايدين ورواد الأعمال والمستثمرين، يقدّم خدماته لأعضائه عبر تطبيق واحد ومقر دائم في قلب العاصمة السعودية الرياض.',
    // M102 (owner, 2026-10-19, verbatim): the rest of the opening text, behind «اقرأ المزيد».
    story: [
      'من السعودية إلى العالم… عضويتك معك أينما كنت؛ فلديك عام كامل تستفيد فيه من جميع مزايا النادي، حضورياً في مقر النادي بمدينة الرياض بالمملكة العربية السعودية، وعبر الإنترنت، وتستكشف المشاريع وفرص الشراكة، لتبني علاقات قد تفتح لك أبوابًا لا يفتحها المال وحده.',
      'وحين تصل إلى الرياض، فالنادي بيتك الثاني في عالم الأعمال، ولا داعي لأن تحمل همّ متطلبات عملك الأساسية؛ فقد وفّرنا لك قاعة اجتماعات لاستقبال ضيوفك، ومقرًّا مجهّزًا يتسع لـ80 شخصًا مع منصة متكاملة لاستضافة ملتقياتك وورش عملك الخاصة، و15 مكتبًا للاستخدام المؤقت، واستوديو بودكاست لتصل رسالتك، وحاضنة أعمال تحتضن مشروعك. كلها متاحة لك بصفتك عضوًا، مع خصومات تخفّف تكاليف أعمالك.',
    ],
  },
  // The owner's wording and order (2026-09-21): the neutral member first.
  portals: [
    {
      key: 'neutral',
      title: 'محايد',
      subtitle: 'أستكشف توجهي',
      titleEn: 'Neutral',
      subtitleEn: 'Exploring my direction',
      icon: 'compass',
      // M10: the neutral is number one — his portal opens his guide, whose first step opens the advisor.
      target: 'guide',
    },
    {
      key: 'entrepreneur',
      title: 'رائد أعمال',
      subtitle: 'لدي مشروع',
      titleEn: 'Entrepreneur',
      subtitleEn: 'Has a venture',
      icon: 'rocket',
      target: 'entrepreneurs',
    },
    {
      key: 'investor',
      title: 'مستثمر',
      subtitle: 'أبحث عن فرص',
      titleEn: 'Investor',
      subtitleEn: 'Seeking opportunities',
      icon: 'briefcase',
      target: 'projects',
    },
  ],
  golden: {
    title: 'المشاريع الذهبية من Vibes Ventures',
    subtitle: 'الشركات التي تحمل علامة V تحت مظلة المنظومة',
    cta: 'عرض الكل',
  },
  membership: {
    title: 'العضوية السنوية لنادي المستثمرين',
    subtitle: 'عضوية سنوية واحدة تفتح كل مزايا النادي: بنك المشاريع، الخدمات، المستشار الذكي، ومقر النادي.',
    cta: 'تعرّف على المزايا',
    activeText: 'عضويتك فعّالة، كل مزايا النادي متاحة لك.',
  },
  services: {
    title: 'خدمات النادي',
    subtitle: 'خدمات الأعضاء ومزايا المنظومة في مكان واحد',
    cta: 'كل الخدمات',
  },
  partners: {
    title: 'شركاؤنا',
    subtitle: 'برومو كودك الخاص يفتح لك خصومات شركاء النادي',
    cta: 'كل الشركاء',
  },
  // M73 (owner, 2026-10-16): «سيرة ومسيرة تبقى في البداية خالص في الصفحة الرئيسية — ده قسم مهم جدًا عندي».
  famous: {
    title: 'شخصية ومسيرة',
    subtitle: 'مساحة أسبوعية تُعرّف بأعضاء النادي وتُبرز خبراتهم وتبني علاقات نوعية بينهم — قدّم بنفسك، التقديم للأعضاء المشتركين فقط',
    cta: 'قدّم من هنا',
  },
  videos: {
    title: 'تعرف علينا',
    subtitle: 'قصة النادي وملتقياته وشركات المنظومة',
    cta: 'كل الفيديوهات',
  },
  // M84: the Projects Bank earns its own home block with the rotating project images.
  projectsBank: {
    title: 'بنك المشاريع',
    subtitle: 'أكثر من 260 مشروعًا اجتازت الفحص والتقييم، بانتظار شريك مثلك',
    cta: 'تصفّح المشاريع',
  },
  // M74-8 (owner, 2026-10-17): the advisor accompanies the neutral and suggests his next step.
  advisor: {
    title: 'مستشارك الذكي معك',
    subtitle: 'يرافقك في رحلتك داخل النادي ويقترح خطوتك القادمة حسب اهتمامك.',
    cta: 'اسأل المستشار',
    chips: [
      { label: 'احجز زيارة للمقر', route: '/hq' },
      { label: 'احضر الملتقى القادم', route: '/agenda' },
      { label: 'سجّل حلقتك في البودكاست', route: '/service/studio' },
      { label: 'استكشف بنك المشاريع', route: '/projects' },
    ],
  },
  // M74-7 (owner): the studio is the neutral's stage — he records an episode introducing himself and his field.
  podcast: {
    title: 'سجّل حلقتك في استوديو النادي',
    subtitle: 'استوديو البودكاست منصّتك: قدّم نفسك ومجالك لمجتمع النادي بحلقة باسمك.',
    cta: 'احجز الاستوديو',
    route: '/service/studio',
  },
  // M74-5: the membership's economics while he explores (wording rules: «بدون رسوم», «رصيد»).
  savings: {
    title: 'عضويتك توفّر عليك',
    subtitle: 'وأنت تستكشف وجهتك، العضوية تخفّف تكاليفك:',
    items: ['ورش العمل والملتقيات بدون رسوم للأعضاء', 'رصيد سنوي يفتح لك خدمات النادي', 'خصومات شركائنا برمز العضو الخاص بك'],
    cta: 'تعرّف على العضوية',
  },
  // M99c: the investor's opening act (the wallet card left the home for good — owner, 2026-10-19: «ملهاش اي داعي»).
  opportunity: {
    title: 'الفرصة الذهبية',
    subtitle: 'مشروع مختار من بنك المشاريع، يتجدد مع كل فتح للتطبيق',
    cta: 'اكتشف الفرصة',
  },
  // M74 + M99: four separate experiences — copy, order, visibility, tabs and the services grid per persona
  // (the owner edits everything from the dashboard).
  personas: {
    guest: {
      // M99a: the picker first, then مميزات العضوية as the guest's first CONTENT block; he browses ALL services.
      heroSubtitle:
        'نادي المستثمرين® مجتمع أعمال حصري للمحايدين ورواد الأعمال والمستثمرين، يقدّم خدماته لأعضائه عبر تطبيق واحد ومقر دائم في قلب العاصمة السعودية الرياض.',
      order: ['portals', 'membership', 'posts', 'agenda', 'projectsBank', 'services', 'partners', 'videos', 'famous'],
    },
    neutral: {
      // M74-6..8 (owner-approved, 2026-10-17): the neutral's home is a discovery journey — events and the
      // companion advisor first, then the inspiration content (شخصية ومسيرة / تعرف علينا / the podcast stage),
      // the Projects Bank as a window, and what the membership saves him while he explores.
      heroSubtitle: 'استكشف الملتقيات وقصص الأعضاء، ودع مستشارك يرافقك حتى تحدّد وجهتك بثقة.',
      order: ['posts', 'agenda', 'advisor', 'quickActions', 'famous', 'videos', 'podcast', 'projectsBank', 'services', 'savings', 'partners'],
      ctas: {
        projectsBank: { label: 'استكشف المشاريع للإلهام', route: '/projects' },
        agenda: { label: 'احضر الملتقى القادم', route: '/agenda' },
      },
    },
    entrepreneur: {
      // M99b + M102 (owner, 2026-10-19): the founder sees HIS two doors first — عرض مشروعه في
      // شركاء النجاح ونشر تطبيقه بدون رسوم — and the rest of the grid waits behind «اضغط للمزيد»
      // (the app collapses the grid for this persona). His journey: present yourself (podcast,
      // شخصية ومسيرة), meet investors (الملتقيات), grow the venture (الخدمات).
      heroSubtitle: 'مشروعك يستحق منصة النادي: اعرضه على المستثمرين في شركاء النجاح، وانشر تطبيقك بدون رسوم.',
      order: ['services', 'posts', 'agenda', 'podcast', 'quickActions', 'famous', 'partners', 'videos'],
      hide: ['projectsBank', 'golden', 'opportunity', 'wallet'],
      hideTabs: ['projects'],
      serviceKeys: ['app-publish', 'pitch-deck', 'meetup', 'studio', 'momentum', 'theater', 'famous'],
      ctas: {
        agenda: { label: 'ملتقى «5 دقائق» بانتظارك', route: '/agenda' },
        services: { label: 'كل خدماتك', route: '/services' },
        podcast: { label: 'عرّف المستثمرين بمشروعك', route: '/service/studio' },
      },
    },
    investor: {
      // M99c + M102 (owner): the Projects Bank appeared three times on his home (الفرصة الذهبية،
      // الكاروسيل، المحفظة) — the carousel block leaves; the opportunity opens and the wallet follows,
      // and the full bank lives in his بنك المشاريع tab.
      heroSubtitle: 'فرص شراكة حقيقية بانتظارك: بنك المشاريع والملتقيات ومجتمع الأعمال في مكان واحد.',
      order: ['opportunity', 'posts', 'quickActions', 'agenda', 'services', 'partners', 'videos', 'famous'],
      hide: ['projectsBank', 'wallet'],
      serviceKeys: ['credit', 'theater', 'consultation', 'meetup'],
      ctas: {
        opportunity: { label: 'استكشف فرص الشراكة', route: '/projects' },
      },
    },
  },
  entrepreneurs: {
    title: 'بوابة رواد الأعمال',
    intro: 'ثلاث خدمات تأخذ مشروعك خطوة أبعد: ملتقى باسمك، عرض مشروعك على المستثمرين عبر شركاء النجاح، وعرض تقديمي احترافي.',
    serviceKeys: ['meetup', 'success-partners', 'pitch-deck'],
  },
  neutralOpening: {
    title: 'محايد — أستكشف توجهي',
    text: 'أهلًا بك في نادي المستثمرين. لم تحدّد وجهتك بعد؟ ابدأ بالحضور: ملتقيات النادي وندواته وورش عمله الدورية تُقام في مقر النادي بالرياض، وأينما كنت يمكنك حضورها عبر الإنترنت. تتعرّف فيها على رواد الأعمال والمستثمرين عن قرب، ثم تحدّد مسارك بثقة. حدّثني عن اهتمامك لأرشّح لك ما يناسبك.',
    quickReplies: ['ما الملتقيات وورش العمل القادمة؟', 'كيف أحضر عبر الإنترنت من خارج الرياض؟', 'لدي فكرة مشروع وأحتاج توجيهًا', 'أريد التعرّف على المنظومة أولًا'],
  },
  version: 13,
  updatedAt: '2026-10-19T00:00:00.000Z',
};

/** Writes the seed when no home content exists yet, or when the stored seed is older than this one. */
export async function ensureHomeSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<HomeContent>(HOME_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= HOME_SEED.version) return false;
  await kv.set(HOME_CONTENT_KEY, HOME_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits (see edits.ts). */
export async function getHomeContent(kv: KV, lang: AppLang = 'ar'): Promise<HomeContent> {
  return localizeBlock(kv, 'home', (await kv.get<HomeContent>(HOME_CONTENT_KEY)) ?? HOME_SEED, HOME_EN, lang);
}
