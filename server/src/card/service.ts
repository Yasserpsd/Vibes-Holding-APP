import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';

/**
 * M30: «كارت العضوية» print requests. The card itself is drawn by the app from `Me` (name, category,
 * `cardNumber`, days left) — nothing is stored for it. What is stored is the member's own request for
 * a printed card delivered to his door at no charge: he must ask for it himself, the management is
 * mailed, and the dashboard lists the requests until they are marked delivered.
 */
export const CARD_REQUESTS_KEY = 'card:printRequests';
const MAX_REQUESTS = 1000;

export type CardRequestStatus = 'pending' | 'done';

export type CardPrintRequest = {
  id: string;
  contactId: number;
  cardNumber: string;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  jobTitle: string;
  /** Where the printed card is delivered, exactly as the member wrote it. */
  city: string;
  address: string;
  note: string;
  status: CardRequestStatus;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
};

/** What the member sees about his own request. */
export type PublicCardRequest = Pick<CardPrintRequest, 'id' | 'status' | 'city' | 'address' | 'createdAt' | 'doneAt'>;

export type CardRequestInput = { city: string; address: string; phone?: string; note?: string };

export function publicCardRequest(request: CardPrintRequest): PublicCardRequest {
  const { id, status, city, address, createdAt, doneAt } = request;
  return { id, status, city, address, createdAt, doneAt };
}

type Deps = { kv: KV; notifier: Notifier };

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

  /** The member himself asks for the printed card; an active annual membership is the door. */
  async request(me: Me, input: CardRequestInput, now = new Date()): Promise<CardPrintRequest> {
    if (me.membership.status !== 'active') {
      throw new RequestError('membership_required', 'طلب النسخة المطبوعة متاح بعد تفعيل العضوية السنوية', 403);
    }
    const request: CardPrintRequest = {
      id: randomUUID(),
      contactId: me.id,
      cardNumber: me.cardNumber,
      name: me.name,
      phone: (input.phone ?? '').trim() || me.phone,
      email: me.email,
      personaLabel: me.personaLabel,
      jobTitle: me.jobTitle,
      city: input.city.trim(),
      address: input.address.trim(),
      note: (input.note ?? '').trim(),
      status: 'pending',
      createdAt: now.toISOString(),
      doneAt: null,
      doneBy: null,
    };
    await this.mutate((requests) => {
      if (requests.some((entry) => entry.contactId === me.id && entry.status === 'pending')) {
        throw new RequestError('already_requested', 'طلبك السابق ما زال قيد التنفيذ لدى الإدارة', 409);
      }
      requests.push(request);
    });
    this.deps.notifier.cardPrintRequested(request);
    return request;
  }

  /** The dashboard marks the card printed and delivered. */
  async markDone(id: string, adminName: string, now = new Date()): Promise<CardPrintRequest | null> {
    return this.mutate((requests) => {
      const request = requests.find((entry) => entry.id === id);
      if (!request) return null;
      if (request.status !== 'done') {
        request.status = 'done';
        request.doneAt = now.toISOString();
        request.doneBy = adminName;
      }
      return request;
    });
  }
}
