import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import { arabicDay, formatAmount, riyadhDateTime } from '../mail/notify.js';
import type { KV } from '../store.js';

/**
 * Member push notifications through Expo's push service (expo-notifications in the app).
 * Tokens are registered per device after login (kv `push:tokens`) and dropped on logout or when
 * Expo reports the device as unregistered. Sends never block a request: they run in the
 * background and their outcome is logged. Management notifications stay e-mails (mail/notify.ts).
 */
export const TOKENS_KEY = 'push:tokens';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const STALE_DAYS = 120;
const TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;

export type PushToken = {
  token: string;
  contactId: number;
  /** M29: the account's persona at the last registration (app launch); older tokens have none until then. */
  persona?: string | null;
  platform: string;
  deviceName: string | null;
  appVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PushMessage = { title: string; body: string; data?: Record<string, string> };
export type PushOutcome = { sent: number; failed: number; dropped: number };

type Ticket = { status: 'ok'; id?: string } | { status: 'error'; message?: string; details?: { error?: string } };

export type PushDeps = { kv: KV; log: FastifyBaseLogger; fetchImpl?: typeof fetch; accessToken?: string };

export function isExpoPushToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export class PushService {
  private chain: Promise<unknown> = Promise.resolve();
  private inflight: Promise<unknown> = Promise.resolve();
  private known = 0;
  private sent = 0;
  private failed = 0;
  private lastError: string | null = null;
  private lastSentAt: string | null = null;

  constructor(private readonly deps: PushDeps) {}

  status(): { tokens: number; sent: number; failed: number; lastError: string | null; lastSentAt: string | null; authenticated: boolean } {
    return { tokens: this.known, sent: this.sent, failed: this.failed, lastError: this.lastError, lastSentAt: this.lastSentAt, authenticated: Boolean(this.deps.accessToken) };
  }

  /** Resolves once every background send started so far has finished (tests). */
  idle(): Promise<void> {
    return this.inflight.then(() => undefined);
  }

  private async load(): Promise<PushToken[]> {
    const stored = (await this.deps.kv.get<{ tokens: PushToken[] }>(TOKENS_KEY))?.tokens ?? [];
    this.known = stored.length;
    return stored;
  }

  private mutate<T>(change: (tokens: PushToken[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const tokens = await this.load();
      const result = change(tokens);
      const cutoff = Date.now() - STALE_DAYS * 86_400_000;
      const kept = tokens.filter((entry) => new Date(entry.updatedAt).getTime() >= cutoff);
      await this.deps.kv.set(TOKENS_KEY, { tokens: kept });
      this.known = kept.length;
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Upserts a device token for the signed-in account; a token moves to the account that last signed in on the device. */
  async register(contactId: number, input: { token: string; platform: string; deviceName?: string | null; appVersion?: string | null }, persona: string | null = null, now = Date.now()): Promise<{ tokens: number }> {
    const token = input.token.trim();
    if (!isExpoPushToken(token)) throw new RequestError('invalid', 'رمز الإشعارات غير صالح');
    const platform = input.platform === 'ios' ? 'ios' : input.platform === 'android' ? 'android' : 'unknown';
    const stamp = new Date(now).toISOString();
    const deviceName = input.deviceName?.trim().slice(0, 80) || null;
    const appVersion = input.appVersion?.trim().slice(0, 20) || null;
    await this.mutate((tokens) => {
      const existing = tokens.find((entry) => entry.token === token);
      if (existing) {
        // A persona missing this time (hub unreachable) keeps the known one — unless the device changed hands.
        existing.persona = persona ?? (existing.contactId === contactId ? (existing.persona ?? null) : null);
        existing.contactId = contactId;
        existing.platform = platform;
        existing.deviceName = deviceName ?? existing.deviceName;
        existing.appVersion = appVersion ?? existing.appVersion;
        existing.updatedAt = stamp;
      } else {
        tokens.push({ token, contactId, persona, platform, deviceName, appVersion, createdAt: stamp, updatedAt: stamp });
      }
    });
    const mine = (await this.load()).filter((entry) => entry.contactId === contactId).length;
    this.deps.log.info({ contactId, platform }, 'push token registered');
    return { tokens: mine };
  }

  async unregister(contactId: number, token: string): Promise<void> {
    await this.mutate((tokens) => {
      const index = tokens.findIndex((entry) => entry.token === token.trim() && entry.contactId === contactId);
      if (index >= 0) tokens.splice(index, 1);
    });
  }

  async tokensFor(contactId: number): Promise<string[]> {
    return (await this.load()).filter((entry) => entry.contactId === contactId).map((entry) => entry.token);
  }

  /** M29: devices whose account carried this persona at the last registration. */
  async tokensForPersona(persona: string): Promise<string[]> {
    return (await this.load()).filter((entry) => entry.persona === persona).map((entry) => entry.token);
  }

  async summary(): Promise<{ total: number; accounts: number; byPlatform: Record<string, number> }> {
    const tokens = await this.load();
    const byPlatform: Record<string, number> = {};
    for (const entry of tokens) byPlatform[entry.platform] = (byPlatform[entry.platform] ?? 0) + 1;
    return { total: tokens.length, accounts: new Set(tokens.map((entry) => entry.contactId)).size, byPlatform };
  }

  /** Sends one message to every device of the account and drops tokens Expo reports as unregistered. */
  async send(contactId: number, message: PushMessage): Promise<PushOutcome> {
    return this.deliver(await this.tokensFor(contactId), message, { contactId });
  }

  /** One message to every registered device (admin posts). */
  async broadcast(message: PushMessage): Promise<PushOutcome> {
    const tokens = (await this.load()).map((entry) => entry.token);
    return this.deliver(tokens, message, { broadcast: true });
  }

  /** M29: one message to every device of one persona's members. */
  async broadcastPersona(persona: string, message: PushMessage): Promise<PushOutcome> {
    return this.deliver(await this.tokensForPersona(persona), message, { persona });
  }

  private async deliver(tokens: string[], message: PushMessage, context: Record<string, unknown>): Promise<PushOutcome> {
    const outcome: PushOutcome = { sent: 0, failed: 0, dropped: 0 };
    if (!tokens.length) return outcome;
    const dead: string[] = [];
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    for (let start = 0; start < tokens.length; start += CHUNK) {
      const batch = tokens.slice(start, start + CHUNK);
      const messages = batch.map((to) => ({ to, title: message.title, body: message.body, data: message.data ?? {}, sound: 'default', priority: 'high', channelId: 'default' }));
      try {
        const response = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(this.deps.accessToken ? { authorization: `Bearer ${this.deps.accessToken}` } : {}),
          },
          body: JSON.stringify(messages),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`expo push ${response.status}: ${text.slice(0, 200)}`);
        const tickets = (JSON.parse(text) as { data?: Ticket[] }).data ?? [];
        tickets.forEach((ticket, index) => {
          if (ticket.status === 'ok') {
            outcome.sent += 1;
            return;
          }
          outcome.failed += 1;
          const reason = ticket.details?.error ?? ticket.message ?? 'unknown';
          this.lastError = reason;
          if (ticket.details?.error === 'DeviceNotRegistered') dead.push(batch[index] as string);
          this.deps.log.warn({ ...context, reason }, 'push ticket error');
        });
      } catch (error) {
        outcome.failed += batch.length;
        this.lastError = error instanceof Error ? error.message : 'push request failed';
        this.deps.log.error({ err: error, ...context }, 'push send failed');
      }
    }
    if (dead.length) {
      outcome.dropped = dead.length;
      await this.mutate((tokens) => {
        for (const token of dead) {
          const index = tokens.findIndex((entry) => entry.token === token);
          if (index >= 0) tokens.splice(index, 1);
        }
      });
    }
    this.sent += outcome.sent;
    this.failed += outcome.failed;
    if (outcome.sent) this.lastSentAt = new Date().toISOString();
    this.deps.log.info({ ...context, ...outcome, title: message.title }, 'push');
    return outcome;
  }

  private background(contactId: number, message: PushMessage): void {
    const run = this.send(contactId, message).catch((error: unknown) => {
      this.deps.log.error({ err: error, contactId }, 'push failed');
    });
    this.inflight = this.inflight.then(() => run);
  }

  hqVisitDecided(visit: { id: string; contactId: number; date: string; time: string; endTime: string; adminNote: string | null }, status: 'confirmed' | 'rejected'): void {
    const when = `${arabicDay(visit.date)} من ${visit.time} إلى ${visit.endTime}`;
    if (status === 'confirmed') {
      this.background(visit.contactId, {
        title: 'تم تأكيد زيارتك للمقر',
        body: `${when}. باركود الدخول جاهز في التطبيق.`,
        data: { type: 'hq_visit', id: visit.id, status, screen: `/hq/pass/${visit.id}` },
      });
      return;
    }
    this.background(visit.contactId, {
      title: 'تعذّر تأكيد زيارتك للمقر',
      body: `${when}. ${visit.adminNote ? `ملاحظة الإدارة: ${visit.adminNote}` : 'يمكنك اختيار موعد آخر من التطبيق.'}`,
      data: { type: 'hq_visit', id: visit.id, status, screen: '/hq' },
    });
  }

  paymentResult(payment: { id: string; contactId: number; serviceTitle: string; amount: number; currency: string; status: 'paid' | 'failed' }): void {
    const paid = payment.status === 'paid';
    this.background(payment.contactId, {
      title: paid ? 'تم الدفع بنجاح' : 'لم يكتمل الدفع',
      body: paid
        ? `اكتمل دفع ${formatAmount(payment.amount, payment.currency)} لخدمة «${payment.serviceTitle}». سنتواصل معك لبدء التنفيذ.`
        : `لم يكتمل دفع خدمة «${payment.serviceTitle}». يمكنك المحاولة مرة أخرى من التطبيق.`,
      data: { type: 'payment', id: payment.id, status: payment.status, screen: `/payment/${payment.id}` },
    });
  }

  /** A person of the club answered in the advisor conversation; the words stay there (no personal data in a push). */
  staffReplied(contactId: number): void {
    this.background(contactId, {
      title: 'رد من فريق النادي',
      body: 'وصلك رد جديد من فريق نادي المستثمرين في محادثة المستشار.',
      data: { type: 'advisor', screen: '/advisor' },
    });
  }

  /** M36: the management answered in «راسل الإدارة»; the words stay in the thread (no personal data in a push). */
  contactReplied(contactId: number): void {
    this.background(contactId, {
      title: 'رد من إدارة النادي',
      body: 'وصلك رد جديد من الإدارة في «راسل الإدارة».',
      data: { type: 'contact', screen: '/contact' },
    });
  }

  /** M41: an agenda attendance fee was paid — the registration is confirmed. */
  agendaConfirmed(contactId: number, eventTitle: string, eventId: string): void {
    this.background(contactId, {
      title: 'تم تأكيد حضورك ✅',
      body: `حضورك في «${eventTitle}» مؤكد. تفاصيل الفعالية في أجندة النادي.`,
      data: { type: 'agenda', screen: `/agenda/${eventId}` },
    });
  }

  /** M11: the administration decided on the member's «شخصية ومسيرة» file. */
  profileDecided(contactId: number, approved: boolean, profileId: string): void {
    this.background(contactId, {
      title: approved ? 'تم اعتماد ملفك في «شخصية ومسيرة»' : 'تحديث بشأن ملفك في «شخصية ومسيرة»',
      body: approved
        ? 'أصبح ملفك ضمن شخصيات نادي المستثمرين الظاهرة في التطبيق.'
        : 'راجعت الإدارة ملفك وكتبت لك ملاحظتها — افتح طلبك لقراءتها.',
      data: { type: 'profile', screen: approved ? `/people/${profileId}` : '/people/apply' },
    });
  }

  membershipActivated(contactId: number, activation: { expiresAt: string | null; pending: boolean }): void {
    this.background(contactId, {
      title: activation.pending ? 'تم استلام اشتراكك' : 'تم تفعيل عضويتك السنوية',
      body: activation.pending
        ? 'سيتم تفعيل عضويتك خلال وقت قصير، وسنخبرك عند التفعيل.'
        : `أهلًا بك في نادي المستثمرين. عضويتك فعّالة الآن${activation.expiresAt ? ` حتى ${riyadhDateTime(activation.expiresAt)}` : ''}.`,
      data: { type: 'membership', status: activation.pending ? 'pending' : 'active', screen: '/membership' },
    });
  }
}
