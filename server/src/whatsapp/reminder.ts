import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { HubClient } from '../hub/types.js';
import type { KV } from '../store.js';
import type { WaResult } from './service.js';

/**
 * M260 (owner, 2026-11-19: «تذكير واحد على واتساب للي سجّل وما فعّلش العضوية بعد 24 ساعة»): one WhatsApp reminder
 * to a member who created an account and has not activated the membership a day later.
 *
 * The rules of M252 are built in, not added later: a reminder is born only from a sign-up that happens AFTER this
 * code is live (there is no backlog to start on), one number hears it ONCE in its life, nothing leaves at night
 * (22:00–09:00 Riyadh), and a reminder that could not leave within fourteen hours of its time is dropped, never
 * sent late. It goes only to a number its owner proved on WhatsApp, and only while the account still has no
 * membership — the hub is asked at the moment of sending (rule 2: the hub is the one registry; what waits here is a
 * short queue of pending messages, emptied as they leave).
 *
 * Rule 3: the message carries no price, no payment link and no way to pay outside the app — it says the account is
 * ready and the membership is completed INSIDE the app.
 */
export type ReminderItem = { phone: string; name: string; lang: string; dueAt: string };
type Queue = { items: ReminderItem[] };

const QUEUE_KEY = 'wa:membership-reminders';
const MAX_QUEUE = 3000;
const MAX_PER_RUN = 10;
const STALE_MS = 14 * 3_600_000;
const seenKey = (phone: string): string => `wa:membership-reminded:${createHash('sha256').update(phone).digest('hex').slice(0, 32)}`;
const digitsOf = (phone: string): string => phone.replace(/\D+/g, '');

/** 22:00–09:00 in Riyadh: nobody is written to. */
export const quietHour = (now: number): boolean => {
  const hour = new Date(now + 3 * 3_600_000).getUTCHours();
  return hour >= 22 || hour < 9;
};

type Deps = {
  kv: KV;
  hub: HubClient;
  log: FastifyBaseLogger;
  /** Sends the template; the service's own records and limits apply. */
  send: (input: { phone: string; name: string; lang: string; ref: string }) => Promise<WaResult>;
  enabled: () => boolean;
  delayMs: number;
  now?: () => number;
};

export class MembershipReminder {
  private running = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** A new account exists: its reminder is due a day from now — unless this number was ever queued before. */
  note(input: { phone: string | null | undefined; name?: string | null; lang?: string | null }): Promise<void> {
    const phone = digitsOf(input.phone ?? '');
    const next = this.chain.then(async () => {
      if (!this.deps.enabled() || phone.length < 8) return;
      if (await this.deps.kv.get(seenKey(phone))) return;
      await this.deps.kv.set(seenKey(phone), { at: new Date(this.now()).toISOString() });
      const queue = (await this.deps.kv.get<Queue>(QUEUE_KEY))?.items ?? [];
      queue.push({ phone, name: String(input.name ?? '').trim().slice(0, 80), lang: input.lang === 'en' ? 'en' : 'ar', dueAt: new Date(this.now() + this.deps.delayMs).toISOString() });
      await this.deps.kv.set(QUEUE_KEY, { items: queue.slice(-MAX_QUEUE) } satisfies Queue);
    });
    // A reminder that could not be queued never fails the sign-up that caused it.
    this.chain = next.catch((error: unknown) => this.deps.log.warn({ err: error }, 'membership reminder not queued'));
    return this.chain.then(() => undefined);
  }

  /** The reminders whose time has come. Each leaves the queue whatever happens to it: one try, never a second. */
  async run(): Promise<{ sent: number; dropped: number; waiting: number }> {
    if (this.running || !this.deps.enabled()) return { sent: 0, dropped: 0, waiting: 0 };
    this.running = true;
    try {
      await this.chain;
      const now = this.now();
      const queue = (await this.deps.kv.get<Queue>(QUEUE_KEY))?.items ?? [];
      if (quietHour(now)) return { sent: 0, dropped: 0, waiting: queue.length };
      const due = queue.filter((item) => Date.parse(item.dueAt) <= now).slice(0, MAX_PER_RUN);
      if (!due.length) return { sent: 0, dropped: 0, waiting: queue.length };
      let sent = 0;
      let dropped = 0;
      for (const item of due) {
        if (now - Date.parse(item.dueAt) > STALE_MS || !(await this.stillOwed(item.phone))) {
          dropped += 1;
          continue;
        }
        const result = await this.deps.send({ phone: item.phone, name: item.name, lang: item.lang, ref: `membership-reminder:${seenKey(item.phone).slice(-12)}` });
        if (result.channel === 'whatsapp') sent += 1;
        else dropped += 1;
      }
      // Written through the same chain as `note`, so a sign-up that arrived meanwhile is kept.
      const gone = new Set(due);
      const write = this.chain.then(async () => {
        const fresh = (await this.deps.kv.get<Queue>(QUEUE_KEY))?.items ?? [];
        const key = (item: ReminderItem): string => `${item.phone}|${item.dueAt}`;
        const done = new Set([...gone].map(key));
        await this.deps.kv.set(QUEUE_KEY, { items: fresh.filter((item) => !done.has(key(item))) } satisfies Queue);
      });
      this.chain = write.catch(() => undefined);
      await write;
      if (sent || dropped) this.deps.log.info({ sent, dropped }, 'membership reminders');
      return { sent, dropped, waiting: Math.max(queue.length - due.length, 0) };
    } catch (error) {
      this.deps.log.warn({ err: error }, 'membership reminders run failed');
      return { sent: 0, dropped: 0, waiting: 0 };
    } finally {
      this.running = false;
    }
  }

  /** Asked at the hub at the moment of sending: an account, its number proven on WhatsApp, still without a membership. */
  private async stillOwed(phone: string): Promise<boolean> {
    try {
      const status = await this.deps.hub.call('member_status', { phone });
      const contact = status.contact;
      return status.found === true && Boolean(contact) && contact?.has_account === 1 && contact.phone_verified === 1 && contact.is_member !== 1 && (status as { is_member?: unknown }).is_member !== 1;
    } catch {
      // The hub did not answer: no message goes out on a guess.
      return false;
    }
  }
}
