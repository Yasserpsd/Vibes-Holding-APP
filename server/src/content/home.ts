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
  /** The same two lines for the English version of the app (owner's wording, 2026-09-21). */
  titleEn?: string;
  subtitleEn?: string;
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
  // The owner's wording and order (2026-09-21): the neutral member first.
  portals: [
    {
      key: 'neutral',
      title: 'محايد',
      subtitle: 'أستكشف توجهي',
      titleEn: 'Neutral',
      subtitleEn: 'Exploring my direction',
      icon: 'compass',
      target: 'advisor',
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
    title: 'المشاريع الذهبية من فايبز القابضة',
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
    title: 'محايد — أستكشف توجهي',
    text: 'أهلًا بك في نادي المستثمرين. لم تحدّد وجهتك بعد؟ ابدأ بالحضور: ملتقيات النادي وندواته وورش عمله الدورية تُقام في مقر النادي بالرياض، وأينما كنت يمكنك حضورها عبر الإنترنت. تتعرّف فيها على رواد الأعمال والمستثمرين عن قرب، ثم تحدّد مسارك بثقة. حدّثني عن اهتمامك لأرشّح لك ما يناسبك.',
    quickReplies: ['ما الملتقيات وورش العمل القادمة؟', 'كيف أحضر عبر الإنترنت من خارج الرياض؟', 'لدي فكرة مشروع وأحتاج توجيهًا', 'أريد التعرّف على المنظومة أولًا'],
  },
  version: 3,
  updatedAt: '2026-09-21T00:00:00.000Z',
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
