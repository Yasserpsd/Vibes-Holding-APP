import type { KV } from '../store.js';

/**
 * Home screen content: the three portals, the golden and membership blocks and the advisor
 * opening for the neutral portal. Editable server content (the dashboard edits it later).
 */
export type PortalKey = 'investor' | 'entrepreneur' | 'neutral';

export type HomePortal = {
  key: PortalKey;
  title: string;
  subtitle: string;
  /** Icon family name known to the app; unknown names fall back to a generic icon. */
  icon: string;
  /** Where the portal leads: the Projects Bank, the entrepreneurs page or the advisor. */
  target: 'projects' | 'entrepreneurs' | 'advisor';
};

export type HomeContent = {
  hero: { eyebrow: string; title: string; subtitle: string };
  portals: HomePortal[];
  golden: { title: string; subtitle: string; cta: string };
  membership: { title: string; subtitle: string; cta: string; activeText: string };
  services: { title: string; subtitle: string; cta: string };
  videos: { title: string; subtitle: string; cta: string };
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
    subtitle: 'اختر بوابتك وابدأ رحلتك في المنظومة: فرص شراكة، خدمات أعمال، ومستشار ذكي.',
  },
  portals: [
    {
      key: 'investor',
      title: 'بوابة المستثمر',
      subtitle: 'تصفّح بنك المشاريع واختر فرص الشراكة التي تناسبك',
      icon: 'briefcase',
      target: 'projects',
    },
    {
      key: 'entrepreneur',
      title: 'بوابة رواد الأعمال',
      subtitle: 'اصنع ملتقاك، شركاء النجاح، وتصميم Pitch Deck لمشروعك',
      icon: 'rocket',
      target: 'entrepreneurs',
    },
    {
      key: 'neutral',
      title: 'بوابة المحايدين',
      subtitle: 'لم تحدد توجهك بعد؟ المستشار الذكي يبدأ معك الحوار',
      icon: 'compass',
      target: 'advisor',
    },
  ],
  golden: {
    title: 'المشاريع الذهبية من فايبز القابضة',
    subtitle: 'الشركات التي تحمل علامة V تحت مظلة المنظومة',
    cta: 'عرض الكل',
  },
  membership: {
    title: 'العضوية الذهبية',
    subtitle: 'عضوية سنوية واحدة تفتح كل مزايا النادي: بنك المشاريع، الخدمات، المستشار الذكي، ومقر النادي.',
    cta: 'تعرّف على المزايا',
    activeText: 'عضويتك فعّالة، كل مزايا النادي متاحة لك.',
  },
  services: {
    title: 'خدمات النادي',
    subtitle: 'خدمات الأعضاء ومزايا المنظومة في مكان واحد',
    cta: 'كل الخدمات',
  },
  videos: {
    title: 'مكتبة الفيديو',
    subtitle: 'قصة النادي وملتقياته وشركات المنظومة',
    cta: 'كل الفيديوهات',
  },
  entrepreneurs: {
    title: 'بوابة رواد الأعمال',
    intro: 'ثلاث خدمات تأخذ مشروعك خطوة أبعد: ملتقى باسمك، عرض مشروعك على المستثمرين عبر شركاء النجاح، وعرض تقديمي احترافي.',
    serviceKeys: ['meetup', 'success-partners', 'pitch-deck'],
  },
  neutralOpening: {
    title: 'بوابة المحايدين',
    text: 'أهلًا بك في نادي المستثمرين. أنا مستشار النادي الذكي، وسأساعدك على تحديد توجهك في المنظومة. حدّثني عن شركتك أو مجال عملك، أو أخبرني إن كنت تفكّر في الاستثمار أو في إطلاق مشروع.',
    quickReplies: ['لدي شركة قائمة وأبحث عن شراكة', 'أفكّر في الاستثمار في مشروع', 'لدي فكرة مشروع وأحتاج توجيهًا', 'أريد التعرّف على المنظومة أولًا'],
  },
  version: 1,
  updatedAt: '2026-09-12T00:00:00.000Z',
};

/** Writes the seed when no home content exists yet, or when the stored seed is older than this one. */
export async function ensureHomeSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<HomeContent>(HOME_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= HOME_SEED.version) return false;
  await kv.set(HOME_CONTENT_KEY, HOME_SEED);
  return true;
}

export async function getHomeContent(kv: KV): Promise<HomeContent> {
  return (await kv.get<HomeContent>(HOME_CONTENT_KEY)) ?? HOME_SEED;
}
