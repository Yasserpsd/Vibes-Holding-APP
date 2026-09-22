import type { AdvisorContext, PortalKey, ScreenKey } from '@/api/advisor';
import { t, type StringKey } from '@/i18n';
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

/**
 * The starter questions live in the app's strings (`advisor.starter.<list>.<n>`, M27 stage 3), so they follow the
 * language and the owner edits them from the dashboard. Each list names how many it has; read while rendering.
 */
const STARTER_LISTS = {
  'screen.home': 3,
  'screen.projects': 4,
  'screen.golden': 3,
  'screen.membership': 4,
  'screen.services': 3,
  'screen.hq': 3,
  'screen.news': 3,
  'screen.videos': 3,
  'screen.posts': 3,
  'screen.about': 3,
  'screen.other': 3,
  project: 4,
  news: 4,
  service: 4,
  event: 3,
  post: 3,
  video: 3,
  entrepreneur: 3,
  investor: 3,
} as const;
type StarterList = keyof typeof STARTER_LISTS;

const starters = (list: StarterList): string[] => Array.from({ length: STARTER_LISTS[list] }, (_, index) => t(`advisor.starter.${list}.${index + 1}` as StringKey));

const SCREEN_LISTS: Partial<Record<ScreenKey, StarterList>> = {
  home: 'screen.home',
  projects: 'screen.projects',
  golden: 'screen.golden',
  membership: 'screen.membership',
  services: 'screen.services',
  hq: 'screen.hq',
  news: 'screen.news',
  videos: 'screen.videos',
  posts: 'screen.posts',
  about: 'screen.about',
};

/** Three or four first questions that fit what the member is looking at. */
export function startersFor(context: ChatContext): string[] {
  switch (context.type) {
    case 'project':
      return starters('project');
    case 'news':
      return starters('news');
    case 'service':
      return starters('service');
    case 'post':
      return starters(context.event ? 'event' : 'post');
    case 'video':
      return starters('video');
    case 'portal':
      return starters(context.id === 'entrepreneur' ? 'entrepreneur' : 'investor');
    case 'screen':
      return starters(SCREEN_LISTS[context.id] ?? 'screen.other');
  }
}

/** The welcome chips when the conversation is empty: the home screen's starters, in the app's language. */
export const welcomeStarters = (): string[] => starters('screen.home');

const OPENING_KEYS: Record<ChatContext['type'], StringKey> = {
  project: 'advisor.opening.project',
  news: 'advisor.opening.news',
  portal: 'advisor.opening.portal',
  service: 'advisor.opening.service',
  post: 'advisor.opening.post',
  video: 'advisor.opening.video',
  screen: 'advisor.opening.screen',
};

/** The advisor's first move for a context: a short line and the starter questions (the suggested prompt first). */
export function openingFor(context: ChatContext, prompt: string | null): ChatOpening {
  const starterList = startersFor(context);
  const quickReplies = prompt ? [prompt, ...starterList.filter((starter) => starter !== prompt)] : starterList;
  return { title: context.title, text: t(OPENING_KEYS[context.type]), quickReplies: quickReplies.slice(0, 4) };
}
