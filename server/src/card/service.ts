import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { AppLang } from '../lang.js';
import type { Notifier } from '../mail/notify.js';
import { fromCard } from '../requests/model.js';
import type { MemberNotices } from '../requests/notices.js';
import type { KV } from '../store.js';

/**
 * M30: «كارت العضوية» print requests. The card itself is drawn by the app from `Me` (name, category,
 * `cardNumber`, days left) — nothing is stored for it. What is stored is the member's own request for
 * a printed card delivered to his door at no charge: he must ask for it himself, the management is
 * mailed, and the dashboard lists the requests until they are marked delivered.
 */
export const CARD_REQUESTS_KEY = 'card:printRequests';
const MAX_REQUESTS = 1000;

export type CardRequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected';

export type CardPrintRequest = {
  id: string;
  contactId: number;
  cardNumber: string;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  jobTitle: string;
  /** M162: picked up at the HQ (no fees) or delivered to the address below (shipping fees by region); old records = delivery. */
  method?: CardDeliveryMethod;
  /** Where the printed card is delivered, exactly as the member wrote it. */
  city: string;
  address: string;
  note: string;
  status: CardRequestStatus;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
  /** M138: the dashboard's note on a decision and the member's app language (for his mails). */
  adminNote?: string | null;
  lang?: AppLang;
  /** M163: a new copy asked for after an earlier card was delivered (lost, damaged). */
  replacement?: boolean;
  /** M163: the member himself marked the card as received (the dashboard may have been slower). */
  memberConfirmedAt?: string | null;
};

/** What the member sees about his own request. */
export type CardDeliveryMethod = 'pickup' | 'delivery';

export type PublicCardRequest = Pick<CardPrintRequest, 'id' | 'status' | 'city' | 'address' | 'createdAt' | 'doneAt'> & {
  method: CardDeliveryMethod;
  replacement: boolean;
  memberConfirmedAt: string | null;
};

export type CardRequestInput = { method?: CardDeliveryMethod; city?: string; address?: string; phone?: string; note?: string };

/** M162: what the pickup request stores where the dashboard expects a city and an address. */
export const PICKUP_CITY = 'الرياض';
export const PICKUP_ADDRESS = 'استلام من مقر النادي (بدون رسوم)';

export function publicCardRequest(request: CardPrintRequest): PublicCardRequest {
  const { id, status, city, address, createdAt, doneAt, method, replacement, memberConfirmedAt } = request;
  return { id, status, city, address, createdAt, doneAt, method: method ?? 'delivery', replacement: replacement === true, memberConfirmedAt: memberConfirmedAt ?? null };
}

type Deps = { kv: KV; notifier: Notifier; notices?: MemberNotices };

export class CardService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<CardPrintRequest[]> {
    return (await this.deps.kv.get<{ requests: CardPrintRequest[] }>(CARD_REQUESTS_KEY))?.requests ?? [];
  }

  private mutate<T>(change: (requests: CardPrintRequest[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const requests = await this.load();
      const result = change(requests);
      requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(CARD_REQUESTS_KEY, { requests: requests.slice(0, MAX_REQUESTS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The member's newest request, so the app shows «قيد التنفيذ» instead of a second button. */
  async mine(contactId: number): Promise<CardPrintRequest | null> {
    return (await this.load()).find((request) => request.contactId === contactId) ?? null;
  }

  async list(): Promise<CardPrintRequest[]> {
    return this.load();
  }

  /** M138: every request of one member, newest first (the timeline). */
  async allMine(contactId: number): Promise<CardPrintRequest[]> {
    return (await this.load()).filter((request) => request.contactId === contactId);
  }

  /** The member himself asks for the printed card; an active annual membership is the door. */
  async request(me: Me, input: CardRequestInput, now = new Date(), lang: AppLang = 'ar'): Promise<CardPrintRequest> {
    if (me.membership.status !== 'active') {
      throw new RequestError('membership_required', 'طلب النسخة المطبوعة متاح بعد تفعيل العضوية السنوية', 403);
    }
    const method: CardDeliveryMethod = input.method ?? 'delivery';
    const request: CardPrintRequest = {
      id: randomUUID(),
      contactId: me.id,
      cardNumber: me.cardNumber,
      name: me.name,
      phone: (input.phone ?? '').trim() || me.phone,
      email: me.email,
      personaLabel: me.personaLabel,
      jobTitle: me.jobTitle,
      method,
      city: method === 'pickup' ? PICKUP_CITY : (input.city ?? '').trim(),
      address: method === 'pickup' ? PICKUP_ADDRESS : (input.address ?? '').trim(),
      note: (input.note ?? '').trim(),
      status: 'pending',
      createdAt: now.toISOString(),
      doneAt: null,
      doneBy: null,
      adminNote: null,
      lang,
      replacement: false,
      memberConfirmedAt: null,
    };
    await this.mutate((requests) => {
      const mine = requests.filter((entry) => entry.contactId === me.id);
      if (mine.some((entry) => entry.status === 'pending' || entry.status === 'in_progress')) {
        throw new RequestError('already_requested', 'طلبك السابق ما زال قيد التنفيذ لدى الإدارة', 409);
      }
      // M163 (owner): a card already delivered once makes this a replacement — the dashboard says so.
      request.replacement = mine.some((entry) => entry.status === 'done');
      requests.push(request);
    });
    this.deps.notifier.cardPrintRequested(request);
    // M138: the member's no-fee receipt, at once.
    this.deps.notices?.received(fromCard(request), { email: me.email, contactEmail: me.contactEmail, name: me.name, lang });
    return request;
  }

  /** M138: the dashboard moves the request along (in progress / delivered / declined); the member is mailed and pushed on a real change. */
  async setStatus(id: string, status: CardRequestStatus, adminName: string, note = '', now = new Date()): Promise<CardPrintRequest | null> {
    const result = await this.mutate((requests) => {
      const request = requests.find((entry) => entry.id === id);
      if (!request) return null;
      const changed = request.status !== status;
      request.status = status;
      if (changed && (status === 'done' || status === 'rejected')) {
        request.doneAt = now.toISOString();
        request.doneBy = adminName;
      }
      if (note.trim()) request.adminNote = note.trim().slice(0, 300);
      return { request, changed };
    });
    if (result?.changed) this.deps.notices?.changed(fromCard(result.request), { email: result.request.email, name: result.request.name, lang: result.request.lang });
    return result?.request ?? null;
  }

  /**
   * M163 (owner): the member says he holds the card (picked it up at the HQ or it arrived). The request closes as
   * delivered with his own mark; the management is mailed, the member is not (he just did it himself).
   */
  async confirmReceived(contactId: number, id: string, now = new Date()): Promise<CardPrintRequest | null> {
    const result = await this.mutate((requests) => {
      const request = requests.find((entry) => entry.id === id && entry.contactId === contactId);
      if (!request || request.status === 'rejected') return null;
      const changed = !request.memberConfirmedAt;
      request.memberConfirmedAt = request.memberConfirmedAt ?? now.toISOString();
      if (request.status !== 'done') {
        request.status = 'done';
        request.doneAt = now.toISOString();
        request.doneBy = 'العضو';
      }
      return { request, changed };
    });
    if (result?.changed) this.deps.notifier.cardReceivedByMember(result.request);
    return result?.request ?? null;
  }

  /** The dashboard marks the card printed and delivered. */
  async markDone(id: string, adminName: string, now = new Date()): Promise<CardPrintRequest | null> {
    return this.setStatus(id, 'done', adminName, '', now);
  }
}
