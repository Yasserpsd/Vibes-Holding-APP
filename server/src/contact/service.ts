import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { Notifier } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import type { KV } from '../store.js';

/**
 * M36: «راسل الإدارة» — every signed-in account writes to the management at any time. M241 (owner,
 * 2026-11-15: «يقدر اي حد يبعت رسالة للإدارة»): the annual membership is no longer the door; the
 * thread only records whether the writer holds one, so the dashboard and the mail can tell.
 * One thread per member, stored on this server as operational data (like card print requests; the
 * hub stays the registry of accounts, rule 2): the dashboard answers, the reply lands back in the
 * app thread with a push, and the management is mailed when a member starts waiting for an answer.
 */
const THREAD_KEY = (contactId: number) => `contact:thread:${contactId}`;
export const CONTACT_INDEX_KEY = 'contact:index';
const MAX_MESSAGES = 300;
const MAX_THREADS = 2000;
const MAX_TEXT = 2000;

export type ContactMessage = {
  id: string;
  from: 'member' | 'admin';
  /** The admin's name on a reply; null when the member himself wrote. */
  by: string | null;
  text: string;
  at: string;
};

export type ContactThread = {
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  cardNumber: string;
  /** M241: an active annual membership at his latest message; absent on threads older than M241 (members only then). */
  annual?: boolean;
  messages: ContactMessage[];
  /** The member's last look at the screen (kept for a future badge). */
  memberSeenAt: string | null;
  /** The dashboard's last look; member messages after it count as unread in the list. */
  adminSeenAt: string | null;
  updatedAt: string;
};

/** One row of the dashboard's list. */
export type ContactThreadSummary = {
  contactId: number;
  name: string;
  personaLabel: string;
  cardNumber: string;
  annual?: boolean;
  lastText: string;
  lastFrom: 'member' | 'admin';
  updatedAt: string;
  unread: number;
};

export function publicMessages(thread: ContactThread): ContactMessage[] {
  return thread.messages;
}

type Deps = { kv: KV; notifier: Notifier; push: PushService };

export class ContactService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  /** Serializes writes: threads and the index always move together. */
  private run<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.chain.then(work);
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  private async loadThread(contactId: number): Promise<ContactThread | null> {
    return await this.deps.kv.get<ContactThread>(THREAD_KEY(contactId));
  }

  private async loadIndex(): Promise<ContactThreadSummary[]> {
    return (await this.deps.kv.get<{ threads: ContactThreadSummary[] }>(CONTACT_INDEX_KEY))?.threads ?? [];
  }

  private async saveThread(thread: ContactThread): Promise<void> {
    thread.messages = thread.messages.slice(-MAX_MESSAGES);
    await this.deps.kv.set(THREAD_KEY(thread.contactId), thread);
    const index = (await this.loadIndex()).filter((entry) => entry.contactId !== thread.contactId);
    const last = thread.messages[thread.messages.length - 1];
    const seen = thread.adminSeenAt ?? '';
    index.push({
      contactId: thread.contactId,
      name: thread.name,
      personaLabel: thread.personaLabel,
      cardNumber: thread.cardNumber,
      annual: thread.annual,
      lastText: (last?.text ?? '').slice(0, 140),
      lastFrom: last?.from ?? 'member',
      updatedAt: thread.updatedAt,
      unread: thread.messages.filter((message) => message.from === 'member' && message.at > seen).length,
    });
    index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.deps.kv.set(CONTACT_INDEX_KEY, { threads: index.slice(0, MAX_THREADS) });
  }

  /** The member's own thread; opening it records his look (his unread lives in the app's badge later). */
  async mine(me: Me, now = new Date()): Promise<ContactMessage[]> {
    return this.run(async () => {
      const thread = await this.loadThread(me.id);
      if (!thread) return [];
      thread.memberSeenAt = now.toISOString();
      await this.deps.kv.set(THREAD_KEY(me.id), thread);
      return publicMessages(thread);
    });
  }

  /** The member writes; the management is mailed when his message starts waiting (not per message). */
  async send(me: Me, text: string, now = new Date()): Promise<ContactMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new RequestError('empty_message', 'اكتب رسالتك أولًا', 400);
    if (trimmed.length > MAX_TEXT) throw new RequestError('message_too_long', 'الرسالة أطول من المسموح', 400);
    const message: ContactMessage = { id: randomUUID(), from: 'member', by: null, text: trimmed, at: now.toISOString() };
    return this.run(async () => {
      const thread: ContactThread = (await this.loadThread(me.id)) ?? {
        contactId: me.id,
        name: me.name,
        phone: me.phone,
        email: me.email,
        personaLabel: me.personaLabel,
        cardNumber: me.cardNumber,
        messages: [],
        memberSeenAt: null,
        adminSeenAt: null,
        updatedAt: now.toISOString(),
      };
      // The hub's data may have moved since the thread began; the row shows the freshest.
      thread.name = me.name || thread.name;
      thread.phone = me.phone || thread.phone;
      thread.email = me.email || thread.email;
      thread.personaLabel = me.personaLabel || thread.personaLabel;
      thread.cardNumber = me.cardNumber || thread.cardNumber;
      thread.annual = me.membership.status === 'active';
      const previous = thread.messages[thread.messages.length - 1];
      thread.messages.push(message);
      thread.memberSeenAt = now.toISOString();
      thread.updatedAt = now.toISOString();
      await this.saveThread(thread);
      // First waiting message of a burst: the thread was empty or already answered.
      if (!previous || previous.from === 'admin') {
        this.deps.notifier.memberMessage({ name: thread.name, phone: thread.phone, email: thread.email, cardNumber: thread.cardNumber, personaLabel: thread.personaLabel, annual: thread.annual }, trimmed);
      }
      return message;
    });
  }

  async adminList(): Promise<ContactThreadSummary[]> {
    return this.loadIndex();
  }

  /** The dashboard opens a thread: the member's waiting messages count as seen. */
  async adminThread(contactId: number, now = new Date()): Promise<ContactThread | null> {
    return this.run(async () => {
      const thread = await this.loadThread(contactId);
      if (!thread) return null;
      thread.adminSeenAt = now.toISOString();
      thread.updatedAt = thread.updatedAt || now.toISOString();
      await this.saveThread(thread);
      return thread;
    });
  }

  /** The management answers: into the thread, and a push carries the member to it. */
  async reply(contactId: number, adminName: string, text: string, now = new Date()): Promise<ContactMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new RequestError('empty_message', 'اكتب الرد أولًا', 400);
    if (trimmed.length > MAX_TEXT) throw new RequestError('message_too_long', 'الرد أطول من المسموح', 400);
    const message: ContactMessage = { id: randomUUID(), from: 'admin', by: adminName, text: trimmed, at: now.toISOString() };
    return this.run(async () => {
      const thread = await this.loadThread(contactId);
      if (!thread) throw new RequestError('not_found', 'لا توجد محادثة لهذا العضو', 404);
      thread.messages.push(message);
      thread.adminSeenAt = now.toISOString();
      thread.updatedAt = now.toISOString();
      await this.saveThread(thread);
      this.deps.push.contactReplied(contactId);
      return message;
    });
  }
}
