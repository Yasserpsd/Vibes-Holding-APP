import { randomUUID } from 'node:crypto';

import { RequestError } from './guard.js';
import type { Me, Persona } from './service.js';
import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';

/**
 * M109d «طلب تغيير الصفة»: the free self-serve persona change is once per membership year (365
 * days, personaChange.ts). A member whose year is used up sends a REQUEST instead; the dashboard
 * approves (the hub applies the persona + a push) or rejects (a push, nothing changes). The
 * member's hub uuid is captured at request time so the approval can apply the change at the hub.
 */
export type PersonaRequestStatus = 'pending' | 'approved' | 'rejected';

export type PersonaChangeRequest = {
  id: string;
  contactId: number;
  /** The member's hub visitor uuid at request time: the approval applies op_profile through it. */
  uuid: string;
  name: string;
  email: string;
  from: Persona | '';
  to: Persona;
  note: string;
  status: PersonaRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
  /** M138: the app language at request time — the member's mails follow it. */
  lang?: AppLang;
};

/** What the member sees about his own request (no uuid, no admin identity). */
export type MyPersonaRequest = Pick<PersonaChangeRequest, 'id' | 'to' | 'status' | 'createdAt' | 'decidedAt' | 'adminNote'>;

export const PERSONA_REQUESTS_KEY = 'persona:requests';
const MAX_REQUESTS = 500;

export function toMyPersonaRequest(request: PersonaChangeRequest): MyPersonaRequest {
  const { id, to, status, createdAt, decidedAt, adminNote } = request;
  return { id, to, status, createdAt, decidedAt, adminNote };
}

/** The dashboard's view: everything but the hub uuid. */
export function toAdminPersonaRequest(request: PersonaChangeRequest): Omit<PersonaChangeRequest, 'uuid'> {
  const { uuid: _uuid, ...rest } = request;
  return rest;
}

export class PersonaRequestsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KV) {}

  private async load(): Promise<PersonaChangeRequest[]> {
    return (await this.kv.get<{ items: PersonaChangeRequest[] }>(PERSONA_REQUESTS_KEY))?.items ?? [];
  }

  private mutate<T>(change: (items: PersonaChangeRequest[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const items = await this.load();
      const result = change(items);
      await this.kv.set(PERSONA_REQUESTS_KEY, { items: items.slice(-MAX_REQUESTS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async create(me: Me, uuid: string, to: Persona, note: string, lang: AppLang = 'ar'): Promise<PersonaChangeRequest> {
    return this.mutate((items) => {
      if (items.some((item) => item.contactId === me.id && item.status === 'pending')) {
        throw new RequestError('duplicate', 'لديك طلب تغيير قائم بالفعل، وستصلك نتيجته بإشعار');
      }
      const request: PersonaChangeRequest = {
        id: randomUUID(),
        contactId: me.id,
        uuid,
        name: me.name,
        email: me.email,
        from: me.persona,
        to,
        note: note.trim().slice(0, 300),
        status: 'pending',
        createdAt: new Date().toISOString(),
        decidedAt: null,
        decidedBy: null,
        adminNote: null,
        lang,
      };
      items.push(request);
      return request;
    });
  }

  /** M138: every request of the member, newest first (the timeline). */
  async allMine(contactId: number): Promise<PersonaChangeRequest[]> {
    return (await this.load()).filter((item) => item.contactId === contactId);
  }

  /** The member's latest request, newest first; null when he never asked. */
  async mine(contactId: number): Promise<PersonaChangeRequest | null> {
    const items = await this.load();
    return items.filter((item) => item.contactId === contactId).at(-1) ?? null;
  }

  async list(status: PersonaRequestStatus | null): Promise<PersonaChangeRequest[]> {
    const items = await this.load();
    return items.filter((item) => !status || item.status === status).reverse();
  }

  /**
   * Marks the decision. The caller applies the persona at the hub FIRST (approve), so a failed
   * hub call leaves the request pending for a retry.
   */
  async decide(id: string, status: 'approved' | 'rejected', decidedBy: string, adminNote: string): Promise<PersonaChangeRequest> {
    return this.mutate((items) => {
      const request = items.find((item) => item.id === id);
      if (!request) throw new RequestError('not_found', 'الطلب غير موجود', 404);
      if (request.status !== 'pending') throw new RequestError('decided', 'تم البت في هذا الطلب من قبل');
      request.status = status;
      request.decidedAt = new Date().toISOString();
      request.decidedBy = decidedBy;
      request.adminNote = adminNote.trim().slice(0, 300) || null;
      return request;
    });
  }

  /** The pending request to approve, with its hub uuid (route-internal). */
  async pending(id: string): Promise<PersonaChangeRequest | null> {
    return (await this.load()).find((item) => item.id === id && item.status === 'pending') ?? null;
  }
}
