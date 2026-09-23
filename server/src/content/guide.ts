import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { localizeBlock } from './edits.js';
import { GUIDE_EN } from './en/guide.js';

/**
 * M10 «دليل المحايد» (owner, 2026-09-16: «المحايد عندي رقم 1»): the page that tells the neutral
 * what to do and where to go, plus the workshops schedule the neutrals benefit from all year.
 * Editable server content like every block («محتوى التطبيق» + «القيم والأسعار»).
 */
export type GuideStep = {
  key: string;
  title: string;
  text: string;
  cta: string;
  /** Where the step's button leads inside the app. */
  target: 'advisor' | 'workshops' | 'projects' | 'membership';
};

export type GuideWorkshop = {
  id: string;
  title: string;
  blurb: string;
  /** Free wording the owner edits: «كل أول خميس من الشهر · 7 مساءً» or «يُعلن عن الموعد قريبًا». */
  schedule: string;
  mode: 'hq' | 'online' | 'both';
  open: boolean;
  order: number;
};

export type GuideContent = {
  title: string;
  intro: string;
  steps: GuideStep[];
  benefitsTitle: string;
  benefits: string[];
  workshops: {
    title: string;
    intro: string;
    note: string;
    registerCta: string;
    registeredText: string;
    closedText: string;
    items: GuideWorkshop[];
  };
  version: number;
  updatedAt: string;
};

export const GUIDE_CONTENT_KEY = 'content:guide';

export const GUIDE_SEED: GuideContent = {
  title: 'دليل المحايد',
  intro: 'لم تحدد وجهتك بعد؟ أنت في المكان الصحيح. هذه خطواتك في نادي المستثمرين حتى تحدد مسارك بثقة: رائد أعمال، مستثمر، أو الاثنان معًا.',
  steps: [
    {
      key: 'advisor',
      title: 'ابدأ بالمستشار الذكي',
      text: 'المستشار يجيبك عن أي سؤال حول النادي والمنظومة، ويتعرف على اهتمامك ويرشّح لك ما يناسبك خطوة بخطوة.',
      cta: 'افتح المستشار',
      target: 'advisor',
    },
    {
      key: 'workshops',
      title: 'احضر الملتقيات وورش العمل',
      text: 'ندوات وورش عمل دورية تُقام في مقر النادي بالرياض، وتحضرها عبر الإنترنت من أي مكان. تتعرف فيها على رواد الأعمال والمستثمرين عن قرب.',
      cta: 'الورش القادمة والتسجيل',
      target: 'workshops',
    },
    {
      key: 'projects',
      title: 'تصفّح بنك المشاريع',
      text: 'شاهد مشاريع رواد الأعمال بمعلوماتها العامة، وتعرّف على القطاعات والمراحل، وخذ فكرة حقيقية عن الفرص داخل المنظومة.',
      cta: 'افتح بنك المشاريع',
      target: 'projects',
    },
    {
      key: 'membership',
      title: 'حين تتضح وجهتك: فعّل عضويتك',
      text: 'العضوية السنوية تفتح لك كل مزايا النادي: التواصل مع مؤسسي المشاريع، خدمات الأعضاء، المستشار بلا حدود يومية ضيقة، ومقر النادي.',
      cta: 'تعرّف على العضوية',
      target: 'membership',
    },
  ],
  benefitsTitle: 'ماذا يقدم النادي للمحايد؟',
  benefits: [
    'ورش عمل وندوات دورية طوال العام، حضورًا في المقر أو عبر الإنترنت.',
    'مستشار ذكي يرافقك من أول سؤال حتى تحديد مسارك.',
    'اطلاع كامل على مشاريع رواد الأعمال بمعلوماتها العامة.',
    'مجتمع من رواد الأعمال والمستثمرين تتعرف عليه عن قرب قبل أن تختار طريقك.',
  ],
  workshops: {
    title: 'ورش العمل والملتقيات',
    intro: 'برنامج دوري يفتح لك أبواب المنظومة: تعلّم، اسأل، وتعرّف على المجتمع. الحضور في مقر النادي بالرياض أو عبر الإنترنت.',
    note: 'التسجيل يصل للإدارة مباشرة، وتصلك تفاصيل الموعد والحضور على جوالك وبريدك.',
    registerCta: 'سجّل اهتمامك',
    registeredText: 'سجّلنا اهتمامك — ستصلك التفاصيل من الإدارة.',
    closedText: 'التسجيل مغلق حاليًا',
    items: [
      {
        id: 'investing-basics',
        title: 'ورشة أساسيات الاستثمار',
        blurb: 'مدخل عملي لفهم الفرص وتقييمها داخل المنظومة، لغير المتخصصين قبل المتخصصين.',
        schedule: 'يُعلن عن الموعد القادم قريبًا',
        mode: 'both',
        open: true,
        order: 1,
      },
      {
        id: 'business-model',
        title: 'ورشة بناء نموذج العمل',
        blurb: 'لمن لديه فكرة ويريد تحويلها إلى مشروع واضح المعالم يعرضه بثقة.',
        schedule: 'يُعلن عن الموعد القادم قريبًا',
        mode: 'both',
        open: true,
        order: 2,
      },
      {
        id: 'club-meetup',
        title: 'ملتقى التعارف الدوري',
        blurb: 'لقاء مفتوح مع أعضاء النادي ورواد الأعمال والمستثمرين في مقر النادي.',
        schedule: 'يُعلن عن الموعد القادم قريبًا',
        mode: 'hq',
        open: true,
        order: 3,
      },
    ],
  },
  version: 1,
  updatedAt: '2026-09-23T00:00:00.000Z',
};

/** Writes the seed when no guide content exists yet, or when the stored seed is older than this one. */
export async function ensureGuideSeed(kv: KV, options: { force?: boolean } = {}): Promise<boolean> {
  const existing = options.force ? null : await kv.get<GuideContent>(GUIDE_CONTENT_KEY);
  if (existing && (existing.version ?? 0) >= GUIDE_SEED.version) return false;
  await kv.set(GUIDE_CONTENT_KEY, GUIDE_SEED);
  return true;
}

/** The block as the app of one language reads it: the stored Arabic block, the English translation for `en`, and the owner's edits. */
export async function getGuideContent(kv: KV, lang: AppLang = 'ar'): Promise<GuideContent> {
  return localizeBlock(kv, 'guide', (await kv.get<GuideContent>(GUIDE_CONTENT_KEY)) ?? GUIDE_SEED, GUIDE_EN, lang);
}
