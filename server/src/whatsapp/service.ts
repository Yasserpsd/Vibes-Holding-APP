import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Mailer } from '../mail/mailer.js';
import type { KV } from '../store.js';
import type { NewTemplate, WaTemplate, WhatsappClient } from './client.js';
import { maskPhone, normalizePhone } from './phone.js';
import { amountText, firstName, nameFor, NOTICE_KINDS, pickTemplate, planDelivery, TEMPLATE_NAMES, toLang, WA_KINDS, type DeliveryPlan, type NoticeKind, type TemplateVars, type WaKind, type WaLang } from './templates.js';

/** What every send answers. `error` explains a fallback too (channel `email`/`none` + why WhatsApp was not used). */
export type WaResult = { channel: 'whatsapp' | 'email' | 'none'; messageId?: string; error?: string };

export type WaRecord = {
  id: string;
  to: string;
  kind: string;
  template: string | null;
  lang: string;
  waMessageId: string | null;
  status: string;
  error: string | null;
  /** The caller's own key (a payment id…): the same kind + ref is never sent twice. */
  ref: string | null;
  createdAt: string;
  updatedAt: string;
};

export const WHATSAPP_LOG_KEY = 'whatsapp:messages';
/** M236: a broadcast to every account writes hundreds of records at once; the newest ones must not push the day's codes and receipts out. */
const KEEP_RECORDS = 2000;
const TEMPLATE_TTL_MS = 10 * 60_000;
/** Delivery states only move forward; `failed` can land at any time. */
const STATUS_ORDER: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

export type SendInput = { phone: string | null | undefined; lang?: string | null; email?: string | null; ref?: string | null };
export type WelcomeInput = SendInput & { name?: string | null };
export type ReceiptInput = SendInput & { amount: number; service: string; invoiceNo: number | string };
export type AffiliateLinkInput = SendInput & { name: string; code: string; link: string };
/** M205: the honorary membership notice; `email` receives the same words when WhatsApp cannot carry them. */
export type HonoraryInput = SendInput & { name?: string | null };
/** M204: the five member messages that left the e-mail for WhatsApp. No `email` here: the caller owns the mail (see `orMail`). */
export type MembershipInput = Omit<SendInput, 'email'> & { name?: string | null; until: string };
export type EventTicketInput = Omit<SendInput, 'email'> & { event: string; date: string; ticket: string };
export type VisitUpdateInput = Omit<SendInput, 'email'> & { status: string };
export type RequestUpdateInput = Omit<SendInput, 'email'> & { service: string; status: string };
export type InvoiceInput = Omit<SendInput, 'email'> & { invoiceNo: number | string; amount: number; currency?: string | null; service: string; link: string };
export type CodeInput = { phone: string | null | undefined; lang?: string | null; code: string };

/** A number gets at most this many codes an hour on WhatsApp; the e-mail copy always goes out. */
const CODE_LIMIT_PER_HOUR = 3;

type Deps = {
  kv: KV;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  /** null = no token on this server: WhatsApp is off and everything falls back. */
  client: WhatsappClient | null;
  /** WHATSAPP_ENABLED=0 switches it off even with a token. */
  enabled: boolean;
  mailer?: Mailer;
  now?: () => number;
  /**
   * M204 (owner: the e-mail of a message goes off only once its template is Active and a send was SEEN arriving): the
   * kinds whose member e-mail is switched off, from `WHATSAPP_MAIL_OFF`. Empty = every message still goes out both ways.
   */
  mailOff?: ReadonlySet<string>;
  /** M204: Meta reported a `code` message as failed; the owner of the code sends it another way. */
  onCodeFailed?: (messageId: string) => Promise<unknown>;
};

export class WhatsappService {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; templates: WaTemplate[] }>();
  /** The e-mails held back because WhatsApp took the message; one is sent if Meta reports the message failed. */
  private readonly heldMail = new Map<string, { at: number; mail: () => void }>();

  constructor(private readonly deps: Deps) {}

  get enabled(): boolean {
    return this.deps.enabled && this.deps.client !== null;
  }

  sendWelcome(input: WelcomeInput): Promise<WaResult> {
    return this.deliver('welcome', input, { name: input.name });
  }

  sendReceipt(input: ReceiptInput): Promise<WaResult> {
    return this.deliver('receipt', input, { amount: input.amount, service: input.service, invoiceNo: input.invoiceNo });
  }

  /** M202: an affiliate's short code and link (Utility template). `ref` keeps one send per code. */
  sendAffiliateLink(input: AffiliateLinkInput): Promise<WaResult> {
    return this.deliver('affiliate_link', input, { name: input.name, code: input.code, link: input.link });
  }

  /** M205: «منحكم العضوية الشرفية», or its end when `ended`; `ref` keeps one message per grant or revoke. */
  sendHonorary(input: HonoraryInput, ended = false): Promise<WaResult> {
    return this.deliver(ended ? 'honorary_ended' : 'honorary', input, { name: firstName(input.name) });
  }

  /**
   * M235 (owner: «كل العمليات توصل واتس اب»): a short notice of what the administration did. `name` (when given) is the
   * template's first variable, `values` the rest in order. No e-mail of its own: the caller's mail goes out as before.
   */
  sendNotice(kind: NoticeKind, input: Omit<SendInput, 'email'> & { name?: string | null }, values: (string | number | null | undefined)[] = []): Promise<WaResult> {
    // M239: an Arabic-script name never opens an English notice, whoever the caller is.
    const greeting = input.name === undefined ? [] : [firstName(nameFor(input.name, toLang(input.lang))) || (toLang(input.lang) === 'en' ? 'Member' : 'عضونا')];
    return this.deliver(kind, input, { list: [...greeting, ...values] });
  }

  /** M204: «تم تفعيل عضويتك… سارية حتى {{2}}». */
  sendMembership(input: MembershipInput): Promise<WaResult> {
    return this.deliver('membership', input, { name: firstName(input.name), date: input.until });
  }

  /** M204: the confirmed booking of an event; `ticket` is the short number, never the entry secret. */
  sendEventTicket(input: EventTicketInput): Promise<WaResult> {
    return this.deliver('event_ticket', input, { event: input.event, date: input.date, ticket: input.ticket });
  }

  sendVisitUpdate(input: VisitUpdateInput): Promise<WaResult> {
    return this.deliver('visit_update', input, { status: input.status });
  }

  sendRequestUpdate(input: RequestUpdateInput): Promise<WaResult> {
    return this.deliver('request_update', input, { service: input.service, status: input.status });
  }

  /** M204: the invoice with its «عرض الفاتورة» button. The owner's one exception: its e-mail ALWAYS goes out too. */
  sendInvoice(input: InvoiceInput): Promise<WaResult> {
    const lang = toLang(input.lang);
    return this.deliver('invoice', input, { invoiceNo: input.invoiceNo, amount: input.amount, amountText: amountText(input.amount, input.currency, lang), service: input.service, buttonLink: input.link });
  }

  /**
   * M204: the activation on WhatsApp, then the royal e-mail by `orMail`. No number, no end date or WhatsApp off = the
   * e-mail alone, at once.
   */
  announceMembership(input: { phone: string | null | undefined; lang?: string | null; name?: string | null; expiresAt: string | null; ref: string }, mail: () => void): void {
    const end = input.expiresAt ? Date.parse(input.expiresAt) : NaN;
    if (!this.enabled || !String(input.phone ?? '').trim() || !Number.isFinite(end)) return mail();
    const until = new Intl.DateTimeFormat(toLang(input.lang) === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(end));
    void this.sendMembership({ phone: input.phone, lang: input.lang, name: input.name, until, ref: input.ref }).then((result) => this.orMail('membership', result, mail));
  }

  /** M204: holds the e-mail copy of a message WhatsApp took; it goes out by itself only if Meta reports that message failed. */
  holdMail(messageId: string, mail: () => void): void {
    this.heldMail.set(messageId, { at: (this.deps.now ?? Date.now)(), mail });
  }

  /**
   * M204: the member's e-mail next to a WhatsApp message. It is sent at once unless WhatsApp took the message AND this
   * kind's e-mail is switched off (`mailOff`); then it is held for an hour and goes out by itself only if Meta reports
   * the message failed (owner: «اي عملية متنفذتش واتس اب تتبعت ايميل»). Held in memory: a restart drops it.
   */
  orMail(kind: WaKind, result: WaResult | null | undefined, mail: () => void): void {
    const now = (this.deps.now ?? Date.now)();
    for (const [id, held] of this.heldMail) if (now - held.at > 3_600_000) this.heldMail.delete(id);
    if (result?.channel === 'whatsapp' && result.messageId && result.error !== 'already_sent' && this.deps.mailOff?.has(kind)) {
      this.heldMail.set(result.messageId, { at: now, mail });
      return;
    }
    if (result?.error === 'already_sent') return;
    mail();
  }

  /**
   * The sign-up and password codes (Authentication template, copy-code button). The code itself is never stored or logged:
   * the record keeps the kind and the number only. Never throws; the hub mails the same code, so a refusal here costs nothing.
   */
  async sendCode(input: CodeInput): Promise<WaResult> {
    try {
      const phone = normalizePhone(input.phone);
      const lang = toLang(input.lang);
      if (!this.enabled) return { channel: 'none', error: 'whatsapp_disabled' };
      if (!phone) return { channel: 'none', error: 'no_phone' };
      const since = (this.deps.now ?? Date.now)() - 3_600_000;
      const recent = (await this.records()).filter((record) => record.kind === 'code' && record.to === phone && Date.parse(record.createdAt) >= since);
      if (recent.length >= CODE_LIMIT_PER_HOUR) return { channel: 'none', error: 'rate_limited' };
      const template = pickTemplate(await this.templatesOf('code'), lang);
      if (!template) return { channel: 'none', error: 'template_not_found' };
      if (template.status !== 'APPROVED') return { channel: 'none', error: 'template_not_approved' };
      const plan = { use: 'whatsapp' as const, template: template.name, language: template.language, params: [input.code] };
      const sent = await this.sendPlanned(plan, { phone, kind: 'code', lang, ref: null }, input.code);
      return sent.messageId ? { channel: 'whatsapp', messageId: sent.messageId } : { channel: 'none', error: sent.error };
    } catch (error) {
      this.deps.log.error({ kind: 'code', err: error instanceof Error ? error.name : 'error' }, 'whatsapp code delivery crashed');
      return { channel: 'none', error: 'internal_error' };
    }
  }

  /** Approved or not, the templates of one kind as Meta lists them (cached ten minutes; stale copy when Meta is down). */
  private async templatesOf(kind: WaKind, fresh = false): Promise<WaTemplate[]> {
    const client = this.deps.client;
    if (!client) return [];
    const name = TEMPLATE_NAMES[kind];
    const now = (this.deps.now ?? Date.now)();
    const hit = this.cache.get(name);
    if (!fresh && hit && now - hit.at < TEMPLATE_TTL_MS) return hit.templates;
    try {
      const templates = await client.listTemplates(name);
      this.cache.set(name, { at: now, templates });
      return templates;
    } catch (error) {
      if (hit) return hit.templates;
      throw error;
    }
  }

  /**
   * Dashboard probe: sends one named template (any approved one, e.g. a Marketing template while the club_* ones are in
   * review) to ONE number, to prove the token, the phone id and the delivery webhook end to end. Admin route only; it is
   * billed by Meta like any template message. Never throws.
   */
  async sendProbe(input: { phone: string; template: string; language: string; params: string[] }): Promise<WaResult> {
    const client = this.deps.client;
    const phone = normalizePhone(input.phone);
    if (!this.enabled || !client) return { channel: 'none', error: 'whatsapp_disabled' };
    if (!phone) return { channel: 'none', error: 'no_phone' };
    const sent = await this.sendPlanned({ use: 'whatsapp', template: input.template, language: input.language, params: input.params }, { phone, kind: 'welcome', lang: toLang(input.language), ref: null });
    return sent.messageId ? { channel: 'whatsapp', messageId: sent.messageId } : { channel: 'none', error: sent.error };
  }

  /**
   * M204: files one new template with Meta for review (nothing is sent to anyone). A name + language Meta already
   * holds is left alone, so the local script can be run again after a partial failure. Never throws.
   */
  async createTemplate(input: NewTemplate): Promise<{ name: string; language: string; created: boolean; status: string; category: string | null; error?: string }> {
    const base = { name: input.name, language: input.language };
    const client = this.deps.client;
    if (!client) return { ...base, created: false, status: 'none', category: null, error: 'whatsapp_disabled' };
    try {
      const existing = (await client.listTemplates(input.name)).find((template) => template.language === input.language);
      if (existing) return { ...base, created: false, status: existing.status, category: existing.category ?? null, error: 'already_exists' };
      const made = await client.createTemplate(input);
      this.cache.delete(input.name);
      this.deps.log.info({ template: input.name, language: input.language, status: made.status }, 'whatsapp template filed with Meta');
      return { ...base, created: true, status: made.status, category: made.category };
    } catch (error) {
      const text = error instanceof Error ? error.message : 'error';
      this.deps.log.warn({ template: input.name, language: input.language, err: text }, 'whatsapp template creation failed');
      return { ...base, created: false, status: 'none', category: null, error: text };
    }
  }

  /** Dashboard view: both kinds with their live status and body text. Always asks Meta. */
  async templateOverview(): Promise<{ name: string; language: string; status: string; category: string | null; body: string }[]> {
    const rows: { name: string; language: string; status: string; category: string | null; body: string }[] = [];
    for (const kind of WA_KINDS) {
      for (const template of await this.templatesOf(kind, true)) {
        const body = template.components.find((component) => component.type.toUpperCase() === 'BODY')?.text ?? '';
        rows.push({ name: template.name, language: template.language, status: template.status, category: template.category ?? null, body });
      }
    }
    return rows;
  }

  private async deliver(kind: WaKind, input: SendInput, given: TemplateVars): Promise<WaResult> {
    try {
      const lang = toLang(input.lang);
      // M239: the same rule for every template and its e-mail fallback — English texts carry no Arabic-script name.
      const vars: TemplateVars = given.name == null ? given : { ...given, name: nameFor(given.name, lang) };
      const phone = normalizePhone(input.phone);
      const ref = input.ref?.trim() || null;
      if (ref) {
        const earlier = (await this.records()).find((record) => record.kind === kind && record.ref === ref && record.waMessageId && record.status !== 'failed');
        if (earlier) return { channel: 'whatsapp', ...(earlier.waMessageId ? { messageId: earlier.waMessageId } : {}), error: 'already_sent' };
      }

      let template: WaTemplate | null | undefined = null;
      if (this.enabled && phone) {
        try {
          template = pickTemplate(await this.templatesOf(kind), lang);
        } catch (error) {
          this.deps.log.warn({ err: error, kind }, 'whatsapp template lookup failed');
          template = undefined;
        }
      }
      const plan = planDelivery({ enabled: this.enabled, phone, kind, lang, vars, template });

      let reason: string = plan.use === 'fallback' ? plan.reason : '';
      if (plan.use === 'whatsapp' && phone) {
        const sent = await this.sendPlanned(plan, { phone, kind, lang, ref }, plan.button);
        if (sent.messageId) return { channel: 'whatsapp', messageId: sent.messageId };
        reason = sent.error;
      }
      return await this.fallback(kind, lang, vars, input.email, reason, phone);
    } catch (error) {
      // The contract: a member's flow never fails because of a message.
      this.deps.log.error({ err: error, kind }, 'whatsapp delivery crashed');
      return { channel: 'none', error: 'internal_error' };
    }
  }

  private async sendPlanned(plan: Extract<DeliveryPlan, { use: 'whatsapp' }>, meta: { phone: string; kind: WaKind; lang: WaLang; ref: string | null }, codeButton?: string): Promise<{ messageId?: string; error: string }> {
    const client = this.deps.client;
    if (!client) return { error: 'whatsapp_disabled' };
    try {
      const messageId = await client.sendTemplate({ to: meta.phone, template: plan.template, language: plan.language, bodyParams: plan.params, ...(codeButton ? { codeButton } : {}) });
      await this.addRecord({ to: meta.phone, kind: meta.kind, template: plan.template, lang: plan.language, waMessageId: messageId, status: 'accepted', error: null, ref: meta.ref });
      this.deps.log.info({ kind: meta.kind, to: maskPhone(meta.phone), template: plan.template }, 'whatsapp template accepted by Meta');
      return { messageId, error: '' };
    } catch (error) {
      const text = error instanceof Error ? error.message : 'error';
      this.deps.log.warn({ kind: meta.kind, to: maskPhone(meta.phone), err: text }, 'whatsapp send failed');
      await this.addRecord({ to: meta.phone, kind: meta.kind, template: plan.template, lang: plan.language, waMessageId: null, status: 'failed', error: text, ref: meta.ref }).catch(() => undefined);
      return { error: `meta_error: ${text}` };
    }
  }

  private async fallback(kind: WaKind, lang: WaLang, vars: TemplateVars, email: string | null | undefined, reason: string, phone: string | null): Promise<WaResult> {
    const address = email?.trim();
    const mail = fallbackMail(kind, lang, vars);
    if (!address || !this.deps.mailer || !mail) {
      this.deps.log.info({ kind, to: maskPhone(phone), reason }, 'whatsapp not sent and no e-mail fallback');
      return { channel: 'none', error: reason };
    }
    try {
      const sent = await this.deps.mailer.send({ to: [address], ...mail });
      if (sent) return { channel: 'email', error: reason };
      return { channel: 'none', error: `${reason}; mail_not_configured` };
    } catch (error) {
      this.deps.log.warn({ err: error, kind }, 'whatsapp fallback mail failed');
      return { channel: 'none', error: `${reason}; mail_failed` };
    }
  }

  // ---------- message log (kv) ----------

  private async records(): Promise<WaRecord[]> {
    return (await this.deps.kv.get<{ messages: WaRecord[] }>(WHATSAPP_LOG_KEY))?.messages ?? [];
  }

  private mutate<T>(fn: (records: WaRecord[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const records = await this.records();
      const result = fn(records);
      await this.deps.kv.set(WHATSAPP_LOG_KEY, { messages: records.slice(-KEEP_RECORDS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private addRecord(input: Omit<WaRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<WaRecord> {
    const at = new Date((this.deps.now ?? Date.now)()).toISOString();
    const record: WaRecord = { id: randomUUID(), createdAt: at, updatedAt: at, ...input };
    return this.mutate((records) => {
      records.push(record);
      return record;
    });
  }

  async recent(limit = 20): Promise<WaRecord[]> {
    return (await this.records()).slice(-limit).reverse();
  }

  /** Meta's webhook: per-message delivery states and the member's own replies (kept minimal). Never throws. */
  async ingestWebhook(body: unknown): Promise<{ statuses: number; inbound: number }> {
    const counts = { statuses: 0, inbound: 0 };
    try {
      const statuses: { id: string; status: string; error: string | null; to: string }[] = [];
      const inbound: { from: string; text: string }[] = [];
      for (const entry of asArray(asObject(body)?.entry)) {
        for (const change of asArray(asObject(entry)?.changes)) {
          const value = asObject(asObject(change)?.value);
          for (const raw of asArray(value?.statuses)) {
            const item = asObject(raw);
            if (typeof item?.id !== 'string' || typeof item.status !== 'string') continue;
            const first = asObject(asArray(item.errors)[0]);
            const error = first ? `${first.code ?? ''} ${String(first.title ?? first.message ?? '')}`.trim().slice(0, 300) : null;
            statuses.push({ id: item.id, status: item.status, error, to: String(item.recipient_id ?? '') });
          }
          for (const raw of asArray(value?.messages)) {
            const item = asObject(raw);
            if (typeof item?.from !== 'string') continue;
            const text = item.type === 'text' ? String(asObject(item.text)?.body ?? '').slice(0, 200) : `[${String(item.type ?? 'message')}]`;
            inbound.push({ from: item.from, text });
          }
        }
      }
      if (!statuses.length && !inbound.length) return counts;
      const at = new Date((this.deps.now ?? Date.now)()).toISOString();
      const failedCodes: string[] = [];
      await this.mutate((records) => {
        for (const status of statuses) {
          const record = records.find((entry) => entry.waMessageId === status.id);
          if (!record) {
            this.deps.log.info({ status: status.status, to: maskPhone(status.to) }, 'whatsapp status for an unknown message');
            continue;
          }
          if (status.status === 'failed' && record.kind === 'code' && record.status !== 'failed') failedCodes.push(status.id);
          const held = this.heldMail.get(status.id);
          if (held && status.status !== 'sent') {
            this.heldMail.delete(status.id);
            // Delivered or read: the e-mail is not needed. Failed: it goes out now.
            if (status.status === 'failed') held.mail();
          }
          const forward = status.status === 'failed' || (STATUS_ORDER[status.status] ?? -1) > (STATUS_ORDER[record.status] ?? -1);
          if (forward) {
            record.status = status.status;
            record.updatedAt = at;
          }
          if (status.error) record.error = status.error;
          this.deps.log.info({ to: maskPhone(record.to), kind: record.kind, status: status.status, ...(status.error ? { error: status.error } : {}) }, 'whatsapp delivery status');
          counts.statuses += 1;
        }
        for (const item of inbound) {
          records.push({ id: randomUUID(), to: item.from, kind: 'inbound', template: null, lang: '', waMessageId: null, status: 'received', error: item.text, ref: null, createdAt: at, updatedAt: at });
          this.deps.log.info({ from: maskPhone(item.from) }, 'whatsapp inbound message');
          counts.inbound += 1;
        }
      });
      for (const messageId of failedCodes) {
        await this.deps.onCodeFailed?.(messageId).catch((error: unknown) => this.deps.log.warn({ err: error instanceof Error ? error.message : 'error' }, 'undelivered code could not be re-sent'));
      }
    } catch (error) {
      this.deps.log.warn({ err: error }, 'whatsapp webhook could not be stored');
    }
    return counts;
  }
}

const asObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The plain e-mail used when WhatsApp cannot carry the message (same facts as the templates). */
export function fallbackMail(kind: WaKind, lang: WaLang, vars: TemplateVars): { subject: string; text: string } | null {
  // M204: the five newer kinds have richer mails of their own, sent by their callers (`orMail`).
  if (NOTICE_KINDS.has(kind)) return null;
  if (kind === 'membership' || kind === 'event_ticket' || kind === 'visit_update' || kind === 'request_update' || kind === 'invoice' || kind === 'code') return null;
  if (kind === 'welcome') {
    return lang === 'en'
      ? { subject: 'Welcome to Investors Club', text: `Welcome${vars.name ? `, ${vars.name}` : ''}. Your membership is active. Open the app to see what is waiting for you.` }
      : { subject: 'أهلاً بك في Investors Club', text: `أهلاً بك${vars.name ? ` يا ${vars.name}` : ''}. تم تفعيل عضويتك، افتح التطبيق لتتعرف على ما ينتظرك.` };
  }
  // M205: the same words as the two WhatsApp templates. The honorary membership belongs only to official partners in
  // the founding contract («عقد التأسيس») of a Vibes Ventures company, and both messages say so (owner, 2026-11-06).
  if (kind === 'honorary') {
    return lang === 'en'
      ? {
          subject: 'Your Honorary Membership of Investors Club',
          text: `Hello${vars.name ? ` ${vars.name}` : ''},\n\nWe are pleased to inform you that you have been granted Honorary Membership of Investors Club, as an official partner under the articles of association of one of the Vibes Ventures companies.\n\nIt has no end date for as long as your partnership stands, and every club benefit is available to you in the app.`,
        }
      : {
          subject: 'عضويتكم الشرفية في نادي المستثمرين',
          text: `مرحبًا${vars.name ? ` ${vars.name}` : ''}،\n\nيسرّنا إبلاغكم بمنحكم العضوية الشرفية في نادي المستثمرين، بصفتكم شريكًا رسميًا في عقد تأسيس إحدى شركات Vibes Ventures.\n\nعضويتكم سارية دون مدة محددة ما دامت شراكتكم قائمة، وجميع مزايا النادي متاحة لكم في التطبيق.`,
        };
  }
  if (kind === 'honorary_ended') {
    return lang === 'en'
      ? {
          subject: 'Your Honorary Membership of Investors Club has ended',
          text: `Hello${vars.name ? ` ${vars.name}` : ''},\n\nPlease note that Honorary Membership of Investors Club is reserved for official partners under the articles of association of the Vibes Ventures companies, and it has ended on your account as of today.\n\nAny active annual membership you hold is not affected. Thank you for your contribution; the club's administration is glad to answer any question.`,
        }
      : {
          subject: 'انتهاء العضوية الشرفية في نادي المستثمرين',
          text: `مرحبًا${vars.name ? ` ${vars.name}` : ''}،\n\nنفيدكم بأن العضوية الشرفية في نادي المستثمرين مخصّصة للشركاء الرسميين في عقود تأسيس شركات Vibes Ventures، وقد انتهى العمل بها في حسابكم اعتبارًا من اليوم.\n\nلا يؤثر ذلك في أي عضوية سنوية سارية لديكم. نشكر لكم ما قدّمتموه، ويسعد إدارة النادي الرد على أي استفسار.`,
        };
  }
  if (kind === 'affiliate_link') {
    return lang === 'en'
      ? { subject: 'Your Investors Club affiliate code', text: `Your code: ${vars.code ?? '-'}. Your link: ${vars.link ?? '-'}.` }
      : { subject: 'رمزك في برنامج ممثلي نادي المستثمرين', text: `رمزك: ${vars.code ?? '-'}. رابطك: ${vars.link ?? '-'}.` };
  }
  const amount = typeof vars.amount === 'number' ? vars.amount : 0;
  return lang === 'en'
    ? { subject: `Payment receipt — invoice ${vars.invoiceNo ?? ''}`.trim(), text: `We received your payment of ${amount} SAR for ${vars.service ?? 'your order'}. Invoice number: ${vars.invoiceNo ?? '-'}.` }
    : { subject: `إيصال دفع — فاتورة رقم ${vars.invoiceNo ?? ''}`.trim(), text: `استلمنا دفعتك بمبلغ ${amount} ريال لخدمة ${vars.service ?? 'طلبك'}. رقم الفاتورة: ${vars.invoiceNo ?? '-'}.` };
}
