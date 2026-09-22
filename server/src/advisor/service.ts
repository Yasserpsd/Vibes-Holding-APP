import type { FastifyBaseLogger } from 'fastify';

import { toMe, type Me } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import type { HubClient, HubContact } from '../hub/types.js';
import type { AppLang } from '../lang.js';
import type { NewsService } from '../news/service.js';
import type { PostsService } from '../posts/service.js';
import type { ProjectsService } from '../projectsBank/service.js';
import type { KV } from '../store.js';
import type { VideosService } from '../videos/service.js';
import { ContextResolver, type AdvisorContext } from './context.js';
import { BlockList, blockListFromConfig, stripUrls, toGate, toMessage, type AdvisorGate, type AdvisorMessage } from './sanitize.js';

const SETTINGS_TTL_MS = 30 * 60_000;
const SETTINGS_RETRY_MS = 60_000;
const DEFAULT_BOT_NAME = 'المستشار';
const DEFAULT_WELCOME = 'حياك الله في نادي المستثمرين. اسألني عن بنك المشاريع أو الشراكات أو العضوية أو خدمات النادي.';
/** Quick-menu entries that invite a web payment are not offered in the app. */
const PAYMENT_TALK = /ادفع|دفع|اشترك/;

export type { AdvisorContext } from './context.js';
export type AdvisorProfile = { botName: string; welcome: string; suggestions: string[] };
export type HistoryResult = { messages: AdvisorMessage[]; profile: AdvisorProfile; me: Me | null };
export type SendResult = { messageId: number | null; waiting: boolean; human: boolean; gate: AdvisorGate | null; me: Me | null };
export type PollResult = { messages: AdvisorMessage[]; waiting: boolean; timeout: boolean; human: boolean; me: Me | null };

type Settings = AdvisorProfile & { block: BlockList };
type Deps = { hub: HubClient; projects: ProjectsService; news: NewsService; kv: KV; log: FastifyBaseLogger; posts?: PostsService; videos?: VideosService };

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const meOf = (contact: HubContact | null | undefined): Me | null => (contact && contact.has_account ? toMe(contact) : null);

/**
 * The AI advisor is the account's hub conversation: the same messages the member sees on the
 * websites, because the hub stores them per account, not per site. The server only relays them.
 * It never writes a reply itself, and it removes what the app must not show (membership and
 * payment links, web prices, widgets that only exist on the web).
 */
export class AdvisorService {
  private settings: { value: Settings; at: number; ttl: number } | null = null;
  private readonly contexts: ContextResolver;

  constructor(private readonly deps: Deps) {
    this.contexts = new ContextResolver(deps);
  }

  /** The hub's webhook says its config changed (`config.changed`): the next message reads it again. */
  resetSettings(): void {
    this.settings = null;
  }

  async history(session: SessionRecord): Promise<HistoryResult> {
    const settings = await this.settingsOf();
    const result = await this.deps.hub.call('history', { uuid: session.uuid });
    return {
      messages: (result.messages ?? []).map((message) => toMessage(message, settings.block)),
      profile: { botName: settings.botName, welcome: settings.welcome, suggestions: settings.suggestions },
      me: meOf(result.contact),
    };
  }

  async send(session: SessionRecord, message: string, context: AdvisorContext | null, ip: string, lang: AppLang = 'ar'): Promise<SendResult> {
    const settings = await this.settingsOf();
    // What the member points at («اسأل المستشار»), built here from public data: the hub hands it to the workflow as `focus`.
    // The English app says so in the page title and the focus, so the brain answers in English (no plugin change).
    const page = await this.contexts.resolve(context, lang);
    const result = await this.deps.hub.call('message', { uuid: session.uuid, message, page_url: page.url, page_title: page.title, ip, ...(page.focus ? { context: page.focus } : {}) });
    const me = meOf(result.contact);
    if (result.gated) {
      return { messageId: null, waiting: false, human: false, gate: toGate(result.gate, result.contact ?? null, settings.block), me };
    }
    return {
      messageId: typeof result.message_id === 'number' ? result.message_id : null,
      waiting: result.waiting === true,
      human: result.human === true,
      gate: null,
      me,
    };
  }

  async poll(session: SessionRecord, after: number): Promise<PollResult> {
    const settings = await this.settingsOf();
    const result = await this.deps.hub.call('poll', { uuid: session.uuid, after });
    return {
      messages: (result.messages ?? []).map((message) => toMessage(message, settings.block)),
      waiting: result.waiting === true,
      timeout: result.timeout === true,
      human: result.human === true,
      me: meOf(result.contact),
    };
  }

  /** Hub widget config: bot name, welcome, quick menu, and the link library that feeds the block list. */
  private async settingsOf(): Promise<Settings> {
    const cached = this.settings;
    if (cached && Date.now() - cached.at < cached.ttl) return cached.value;
    try {
      const result = await this.deps.hub.call('config', {});
      const config = result.config ?? {};
      const block = blockListFromConfig(config);
      const menu = Array.isArray(config.menu) ? config.menu : [];
      const value: Settings = {
        block,
        botName: text(config.bot_name, 60) || DEFAULT_BOT_NAME,
        welcome: stripUrls(text(config.welcome, 600), block) || DEFAULT_WELCOME,
        suggestions: menu
          .map((item) => text(item, 80))
          .filter((item) => item && !PAYMENT_TALK.test(item))
          .slice(0, 6),
      };
      this.settings = { value, at: Date.now(), ttl: SETTINGS_TTL_MS };
      return value;
    } catch (error) {
      this.deps.log.warn({ err: error }, 'hub config unavailable, the advisor uses defaults');
      const value: Settings = { block: new BlockList(), botName: DEFAULT_BOT_NAME, welcome: DEFAULT_WELCOME, suggestions: [] };
      this.settings = { value, at: Date.now(), ttl: SETTINGS_RETRY_MS };
      return value;
    }
  }
}
