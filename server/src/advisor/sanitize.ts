import type { HubContact, HubGate, HubMessage } from '../hub/types.js';

/**
 * What the app may render from a hub reply. Web-only widgets (forms, scroll, hand-off, admin
 * commands) are dropped, and anything that sells the membership or takes a payment on the web is
 * removed here so it can never reach a phone (CLAUDE.md rule 3).
 */
export type AdvisorAction =
  | { type: 'quick_replies'; options: string[] }
  | { type: 'link'; label: string; url: string }
  | { type: 'video'; title: string; url: string }
  /** The hub offered the membership: the app points to its own membership screen instead. */
  | { type: 'membership' }
  | { type: 'card'; title: string; price: string | null; note: string | null; bullets: string[]; url: string | null };

export type AdvisorRole = 'user' | 'assistant' | 'staff' | 'system';

export type AdvisorMessage = {
  id: number;
  role: AdvisorRole;
  text: string;
  at: string;
  /** Staff member's name on replies written from the hub console. */
  by: string | null;
  image: string | null;
  audio: string | null;
  actions: AdvisorAction[];
};

export type AdvisorGateType = 'membership' | 'daily' | 'rate' | 'site_cap' | 'contact' | 'other';
export type AdvisorGate = { type: AdvisorGateType; text: string; membership: boolean; expired: boolean };

const GATE_TEXTS: Record<AdvisorGateType | 'expired', string> = {
  membership: 'المستشار الذكي متاح بشكل كامل لأعضاء النادي. فعّل عضويتك من شاشة العضوية لنكمل المحادثة.',
  expired: 'انتهت عضويتك السنوية. جدّدها من شاشة العضوية لنكمل المحادثة.',
  daily: 'وصلت إلى حد الرسائل اليومي لعضويتك. نكمل غدًا بإذن الله.',
  rate: 'رسائل كثيرة في وقت قصير. خذ نفسًا وعاود بعد قليل.',
  site_cap: 'المستشار وصل إلى حده اليومي. عاود المحاولة لاحقًا.',
  contact: 'سجّل الدخول أولًا لتتحدث مع المستشار.',
  other: 'تعذّر إرسال الرسالة الآن. حاول بعد قليل.',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown, max = 500): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Payment gateways and checkout pages are blocked whatever the hub config says. */
const PAYMENT_URL = /paymob|checkout|\/pay(?:ment)?(?:[/?#]|$)/i;
/** Link-library entries about the membership, subscribing or paying. */
const MEMBERSHIP_WORDS = /عضوي|اشتر|ادفع|دفع|pay|member|subscri|checkout/i;
/** Button labels the hub uses for web payments (`service_card()` in the plugin). */
const PAY_LABEL = /ادفع|اشترك الآن/;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]«»"']+/gi;
const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const TRAILING_PUNCTUATION = /[.,،;:!?]+$/;

function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '');
}

/** URLs the app must never show: membership and payment pages. */
export class BlockList {
  private readonly urls = new Set<string>();

  constructor(urls: Iterable<string> = []) {
    for (const url of urls) this.add(url);
  }

  add(url: unknown): void {
    const text = asString(url, 2000);
    if (text) this.urls.add(normalizeUrl(text));
  }

  blocks(url: string): boolean {
    const normalized = normalizeUrl(url);
    if (!normalized) return true;
    if (PAYMENT_URL.test(normalized)) return true;
    return this.urls.has(normalized);
  }
}

/** Reads the membership card and the link library out of the hub's `config` answer (`widget_config()`). */
export function blockListFromConfig(config: Record<string, unknown>): BlockList {
  const block = new BlockList();
  const membership = config.membership;
  if (isRecord(membership)) {
    block.add(membership.url);
    block.add(membership.pay_url);
    if (Array.isArray(membership.buttons)) {
      for (const button of membership.buttons) if (isRecord(button)) block.add(button.url);
    }
  }
  if (Array.isArray(config.links)) {
    for (const link of config.links) {
      if (isRecord(link) && MEMBERSHIP_WORDS.test(`${asString(link.l)} ${asString(link.k)}`)) block.add(link.u);
    }
  }
  return block;
}

/** Removes blocked links from free text; allowed markdown links become "label url" so the app can tap them. */
export function stripUrls(text: string, block: BlockList): string {
  const cleaned = text
    .replace(MARKDOWN_LINK, (_match, label: string, url: string) => (block.blocks(url) ? '' : `${label} ${url}`))
    .replace(URL_PATTERN, (url) => {
      const tail = TRAILING_PUNCTUATION.exec(url)?.[0] ?? '';
      const core = tail ? url.slice(0, -tail.length) : url;
      return block.blocks(core) ? tail : url;
    });
  return cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keeps the widgets a phone can use; see `expand_actions()` in the plugin for the input shapes. */
export function toActions(raw: unknown, block: BlockList): AdvisorAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AdvisorAction[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    switch (item.type) {
      case 'quick_replies': {
        const options = Array.isArray(item.options) ? item.options.map((option) => asString(option, 48)).filter(Boolean) : [];
        if (options.length) out.push({ type: 'quick_replies', options: options.slice(0, 4) });
        break;
      }
      case 'link':
      case 'open_page': {
        const url = asString(item.url, 2000);
        const label = asString(item.label, 80).replace(/\s*↗\s*$/, '');
        if (url && !block.blocks(url) && !PAY_LABEL.test(label)) out.push({ type: 'link', label: label || 'افتح الصفحة', url });
        break;
      }
      case 'video': {
        const url = asString(item.url, 2000);
        if (url) out.push({ type: 'video', title: asString(item.title, 120) || 'فيديو', url });
        break;
      }
      case 'card': {
        const card = isRecord(item.card) ? item.card : null;
        if (!card) break;
        if (asString(card.key) === 'membership') {
          if (!out.some((action) => action.type === 'membership')) out.push({ type: 'membership' });
          break;
        }
        const title = asString(card.title, 150);
        if (!title) break;
        const buttons = Array.isArray(card.buttons) ? card.buttons.filter(isRecord) : [];
        const detail = buttons
          .filter((button) => !PAY_LABEL.test(asString(button.label, 80)))
          .map((button) => asString(button.url, 2000))
          .find((url) => url && !block.blocks(url));
        out.push({
          type: 'card',
          title,
          price: asString(card.price, 80) || null,
          note: asString(card.note, 300) || null,
          bullets: Array.isArray(card.bullets) ? card.bullets.map((bullet) => asString(bullet, 200)).filter(Boolean).slice(0, 8) : [],
          url: detail ?? null,
        });
        break;
      }
      default:
        // admin, prefill_form, scroll_to, handoff, request_contact: only meaningful inside the web widget.
        break;
    }
  }
  return out;
}

const ROLES: Record<string, AdvisorRole> = { user: 'user', assistant: 'assistant', human: 'staff', system: 'system' };

export function toMessage(message: HubMessage, block: BlockList): AdvisorMessage {
  const role = ROLES[message.role] ?? 'system';
  const content = asString(message.content, 12_000);
  return {
    id: Number(message.id),
    role,
    text: role === 'user' ? content : stripUrls(content, block),
    at: asString(message.at, 40),
    by: asString(message.by, 120) || null,
    image: asString(message.image, 2000) || null,
    audio: asString(message.audio, 2000) || null,
    actions: role === 'assistant' || role === 'staff' ? toActions(message.actions, block) : [],
  };
}

/** The hub's gate texts sell the web membership; the app gets its own wording and points to its membership screen. */
export function toGate(gate: HubGate | undefined, contact: HubContact | null, block: BlockList): AdvisorGate {
  const type = gate?.type ?? 'other';
  if (type === 'membership') {
    const expired = contact?.member_expired === 1;
    return { type, text: expired ? GATE_TEXTS.expired : GATE_TEXTS.membership, membership: true, expired };
  }
  if (type === 'rate') {
    return { type, text: stripUrls(asString(gate?.text, 300), block) || GATE_TEXTS.rate, membership: false, expired: false };
  }
  if (type === 'daily' || type === 'site_cap' || type === 'contact') {
    return { type, text: GATE_TEXTS[type], membership: false, expired: false };
  }
  return { type: 'other', text: GATE_TEXTS.other, membership: false, expired: false };
}
