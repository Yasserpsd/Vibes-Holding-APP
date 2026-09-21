import type { AdvisorContext, PortalKey, ScreenKey } from '@/api/advisor';
import { t } from '@/i18n';
import type { IoniconName } from '@/lib/icons';

/** What the member was looking at when he opened the advisor; sent with each message until he removes the pill. */
export type ChatContext =
  | { type: 'project'; id: number; title: string }
  | { type: 'news'; id: string; title: string }
  | { type: 'portal'; id: PortalKey; title: string }
  | { type: 'service'; id: string; title: string }
  /** `event`: the post is an event, so the starter questions talk about attending. */
  | { type: 'post'; id: string; title: string; event?: boolean }
  | { type: 'video'; id: string; title: string }
  | { type: 'screen'; id: ScreenKey; title: string };

/** The advisor opens the conversation itself: shown until the member answers. */
export type ChatOpening = { title: string; text: string; quickReplies: string[] };

/** Route params of the advisor tab; the nonce makes every tap a new request. `prompt` is a suggested first message. */
export type ContextParams = { ctxType?: string; ctxId?: string; ctxTitle?: string; ctxEvent?: string; ctxNonce?: string; prompt?: string };

export const CONTEXT_ICONS: Record<ChatContext['type'], IoniconName> = {
  project: 'briefcase-outline',
  news: 'newspaper-outline',
  portal: 'compass-outline',
  service: 'grid-outline',
  post: 'megaphone-outline',
  video: 'play-circle-outline',
  screen: 'phone-portrait-outline',
};

const SCREEN_KEYS: ScreenKey[] = ['home', 'projects', 'golden', 'membership', 'services', 'hq', 'news', 'videos', 'posts', 'advisor', 'account', 'about'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server takes only type and id and builds the text from its own public data. */
export function toApiContext(context: ChatContext | null): AdvisorContext | null {
  if (!context) return null;
  switch (context.type) {
    case 'project':
      return { type: 'project', id: context.id };
    case 'news':
      return { type: 'news', id: context.id };
    case 'portal':
      return { type: 'portal', id: context.id };
    case 'service':
      return { type: 'service', id: context.id };
    case 'post':
      return { type: 'post', id: context.id };
    case 'video':
      return { type: 'video', id: context.id };
    case 'screen':
      return { type: 'screen', id: context.id };
  }
}

export function contextParams(context: ChatContext, prompt?: string): ContextParams {
  return {
    ctxType: context.type,
    ctxId: String(context.id),
    ctxTitle: context.title,
    ctxNonce: String(Date.now()),
    ...(context.type === 'post' && context.event ? { ctxEvent: '1' } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

/** Reads the params back; ids are checked against what the server accepts, anything else is ignored. */
export function parseContextParams(params: ContextParams): { key: string; context: ChatContext; prompt: string | null } | null {
  const key = `${params.ctxType ?? ''}:${params.ctxId ?? ''}:${params.ctxNonce ?? ''}`;
  const title = params.ctxTitle?.trim() ?? '';
  const prompt = params.prompt?.trim() || null;
  const id = params.ctxId ?? '';
  switch (params.ctxType) {
    case 'project': {
      const number = Number(id);
      if (!Number.isInteger(number) || number <= 0) return null;
      return { key, context: { type: 'project', id: number, title: title || t('advisor.ctx.project', { number }) }, prompt };
    }
    case 'news':
      if (!/^[a-f0-9]{16}$/.test(id)) return null;
      return { key, context: { type: 'news', id, title: title || t('advisor.ctx.news') }, prompt };
    case 'portal':
      if (id !== 'neutral' && id !== 'entrepreneur' && id !== 'investor') return null;
      return { key, context: { type: 'portal', id, title: title || t('advisor.ctx.portal') }, prompt };
    case 'service':
      if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
      return { key, context: { type: 'service', id, title: title || t('advisor.ctx.service') }, prompt };
    case 'post':
      if (!UUID.test(id)) return null;
      return { key, context: { type: 'post', id, title: title || t('advisor.ctx.post'), event: params.ctxEvent === '1' }, prompt };
    case 'video':
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
      return { key, context: { type: 'video', id, title: title || t('advisor.ctx.video') }, prompt };
    case 'screen': {
      const screen = SCREEN_KEYS.find((candidate) => candidate === id);
      if (!screen) return null;
      return { key, context: { type: 'screen', id: screen, title: title || t('advisor.ctx.screen') }, prompt };
    }
    default:
      return null;
  }
}

const SCREEN_STARTERS: Partial<Record<ScreenKey, string[]>> = {
  home: ['من أين أبدأ في النادي؟', 'ما الجديد في النادي هذا الأسبوع؟', 'ما الخدمات التي تناسبني؟'],
  projects: ['رشّح لي مشاريع تناسب اهتماماتي', 'كيف أقيّم مشروعًا في بنك المشاريع؟', 'ما القطاعات الأكثر نشاطًا في البنك؟', 'كيف أستخدم رصيد بنك المشاريع؟'],
  golden: ['ما الذي يميّز المشاريع الذهبية؟', 'قارن لي بين الشركات الذهبية', 'كيف أبدأ شراكة مع إحدى هذه الشركات؟'],
  membership: ['ما الذي تضيفه لي العضوية السنوية؟', 'كيف أستفيد من رصيد بنك المشاريع؟', 'ما خدمات الأعضاء التي تنصحني بها؟', 'كيف أفعّل عضويتي من التطبيق؟'],
  services: ['ما الخدمة الأنسب لوضعي؟', 'قارن لي بين خدمات النادي', 'ما الخدمات المتاحة بدون رسوم للأعضاء؟'],
  hq: ['ما الذي يقدمه مقر النادي للأعضاء؟', 'كيف أحجز زيارة للمقر؟', 'كيف أستعد لاجتماع في المقر؟'],
  news: ['ما أهم ما يخص المستثمرين اليوم؟', 'ما القرارات الجديدة التي تهم أصحاب الأعمال؟', 'كيف أتابع أخبار قطاعي؟'],
  videos: ['رشّح لي فيديو أبدأ به', 'ما أهم الدروس في فيديوهات النادي؟', 'هل يوجد فيديو عن تقييم المشاريع؟'],
  posts: ['ما أهم رسائل الإدارة مؤخرًا؟', 'هل توجد فعاليات قادمة؟', 'كيف أشارك في فعاليات النادي؟'],
  about: ['عرّفني بنادي المستثمرين', 'ما علاقة النادي بفايبز القابضة؟', 'ما شركات المنظومة وما دور كل منها؟'],
};

/** Three or four first questions that fit what the member is looking at. */
export function startersFor(context: ChatContext): string[] {
  switch (context.type) {
    case 'project':
      return ['ما رأيك في هذا المشروع؟', 'ما أبرز نقاط القوة والمخاطر؟', 'من ينافسه في بنك المشاريع؟', 'ما الأسئلة التي أطرحها على المؤسس؟'];
    case 'news':
      return ['ما أثر هذا الخبر على المستثمرين؟', 'اشرح لي خلفية هذا الخبر', 'هل يرتبط بمشاريع في بنك المشاريع؟', 'ما الخطوة العملية التي تقترحها؟'];
    case 'service':
      return ['ما الذي تشمله هذه الخدمة؟', 'هل تناسب وضعي الحالي؟', 'ما خطوات الطلب؟', 'ما البدائل القريبة منها في النادي؟'];
    case 'post':
      return context.event
        ? ['لمن تناسب هذه الفعالية؟', 'كيف أستعد لحضورها؟', 'ما الذي سأخرج به منها؟']
        : ['ما المطلوب مني في هذه الرسالة؟', 'كيف أستفيد مما جاء فيها؟', 'هل لها علاقة بخدمات النادي؟'];
    case 'video':
      return ['ما أهم أفكار هذا الفيديو؟', 'كيف أطبّق ما فيه على مشروعي؟', 'رشّح لي فيديو مكمّلًا له'];
    case 'portal':
      return context.id === 'entrepreneur'
        ? ['كيف أجهّز مشروعي للعرض على المستثمرين؟', 'ما الخدمة الأنسب لمرحلة مشروعي؟', 'كيف أضيف مشروعي إلى بنك المشاريع؟']
        : ['كيف أجد فرص شراكات تناسبني؟', 'كيف أقيّم مشروعًا قبل التواصل مع مؤسسه؟', 'ما الذي يقدمه النادي للمستثمر؟'];
    case 'screen':
      return SCREEN_STARTERS[context.id] ?? ['كيف أستفيد من هذه الشاشة؟', 'ما الذي تنصحني به الآن؟', 'ما الجديد في النادي؟'];
  }
}

const OPENING_TEXT: Record<ChatContext['type'], string> = {
  project: 'اطّلعت على بيانات هذا المشروع المنشورة في بنك المشاريع. اسألني عنه أو اختر سؤالًا للبداية.',
  news: 'نناقش هذا الخبر كما نشره مصدره. اسألني عن أثره أو اختر سؤالًا للبداية.',
  portal: 'أنا معك في هذه البوابة. اسألني أو اختر سؤالًا للبداية.',
  service: 'يمكنني مساعدتك في هذه الخدمة. اسألني أو اختر سؤالًا للبداية.',
  post: 'قرأت ما نشرته الإدارة هنا. اسألني عنه أو اختر سؤالًا للبداية.',
  video: 'اسألني عن هذا الفيديو أو اختر سؤالًا للبداية.',
  screen: 'أنا معك في هذه الشاشة. اسألني أو اختر سؤالًا للبداية.',
};

/** The advisor's first move for a context: a short line and the starter questions (the suggested prompt first). */
export function openingFor(context: ChatContext, prompt: string | null): ChatOpening {
  const starters = startersFor(context);
  const quickReplies = prompt ? [prompt, ...starters.filter((starter) => starter !== prompt)] : starters;
  return { title: context.title, text: OPENING_TEXT[context.type], quickReplies: quickReplies.slice(0, 4) };
}
