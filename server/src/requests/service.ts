import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AgendaService } from '../agenda/service.js';
import type { AccountDeletionStore } from '../auth/deletion.js';
import { RequestError } from '../auth/guard.js';
import type { PersonaRequestsService } from '../auth/personaRequests.js';
import type { Me } from '../auth/service.js';
import type { CardService } from '../card/service.js';
import type { FormsService } from '../forms/service.js';
import type { HqService } from '../hq/service.js';
import type { AppLang } from '../lang.js';
import type { PaymentsService } from '../payments/service.js';
import type { ProfilesService } from '../profiles/service.js';
import type { KV } from '../store.js';
import type { WorkshopsService } from '../workshops/service.js';
import {
  fromAgenda,
  fromCard,
  fromDeletion,
  fromForm,
  fromLedger,
  fromPayment,
  fromPersona,
  fromProfile,
  fromPublicVisit,
  fromWorkshop,
  type LedgerEntry,
  type MemberRequest,
  type RequestRow,
  type RequestStatus,
} from './model.js';
import type { MemberNotices } from './notices.js';

export const LEDGER_KEY = 'requests:ledger';
const MAX_ENTRIES = 5000;

/** The stores the timeline reads; each is optional so old tests that build fewer services still pass. */
export type RequestSources = {
  card?: CardService;
  hq?: HqService;
  forms?: FormsService;
  workshops?: WorkshopsService;
  agenda?: AgendaService;
  persona?: PersonaRequestsService;
  profiles?: ProfilesService;
  payments?: PaymentsService;
  deletion?: AccountDeletionStore;
};

type Deps = { kv: KV; log: FastifyBaseLogger; notices?: MemberNotices; sources?: RequestSources };

export type LedgerInput = { kind: LedgerEntry['kind']; title: string; ref: string; rows: RequestRow[]; lang: AppLang };

/**
 * M138: the member's unified timeline («متابعة طلباتي») and the ledger of the operations that had
 * no store of their own (service requests, golden interests). Everything else is read from its
 * own store, so there is one truth per request.
 */
export class RequestsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<LedgerEntry[]> {
    return (await this.deps.kv.get<{ entries: LedgerEntry[] }>(LEDGER_KEY))?.entries ?? [];
  }

  private mutate<T>(change: (entries: LedgerEntry[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const entries = await this.load();
      const result = change(entries);
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(LEDGER_KEY, { entries: entries.slice(0, MAX_ENTRIES) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Records a member's service request or golden interest and mails him the receipt. */
  async record(me: Me, input: LedgerInput, now = new Date()): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: randomUUID(),
      kind: input.kind,
      contactId: me.id,
      name: me.name,
      phone: me.phone,
      email: me.contactEmail || me.email,
      lang: input.lang,
      title: input.title,
      ref: input.ref,
      rows: input.rows,
      status: 'pending',
      createdAt: now.toISOString(),
      updatedAt: null,
      decidedBy: null,
      adminNote: null,
    };
    await this.mutate((entries) => {
      entries.push(entry);
    });
    this.deps.notices?.received(fromLedger(entry), { email: entry.email, name: entry.name, lang: entry.lang });
    return entry;
  }

  async list(): Promise<LedgerEntry[]> {
    return this.load();
  }

  /** The dashboard moves an entry along; the member is mailed and pushed when the status really changed. */
  async setStatus(id: string, status: RequestStatus, adminName: string, note = '', now = new Date()): Promise<LedgerEntry> {
    const { entry, changed } = await this.mutate((entries) => {
      const found = entries.find((item) => item.id === id);
      if (!found) throw new RequestError('not_found', 'الطلب غير موجود', 404);
      const changed = found.status !== status || (note.trim() && note.trim() !== (found.adminNote ?? ''));
      found.status = status;
      found.updatedAt = now.toISOString();
      found.decidedBy = adminName;
      found.adminNote = note.trim().slice(0, 300) || found.adminNote;
      return { entry: found, changed: Boolean(changed) };
    });
    if (changed) this.deps.notices?.changed(fromLedger(entry), { email: entry.email, name: entry.name, lang: entry.lang });
    return entry;
  }

  /** Every operation of one member, newest first. A failing source leaves a hole, never a 500. */
  async timeline(contactId: number): Promise<MemberRequest[]> {
    const sources = this.deps.sources ?? {};
    const parts = await Promise.all([
      this.safe('ledger', async () => (await this.load()).filter((entry) => entry.contactId === contactId).map(fromLedger)),
      this.safe('card', async () => (await sources.card?.allMine(contactId))?.map(fromCard) ?? []),
      this.safe('hq', async () => (await sources.hq?.history(contactId))?.map((visit) => fromPublicVisit(visit, contactId)) ?? []),
      this.safe('forms', async () => (await sources.forms?.mine(contactId))?.map(fromForm) ?? []),
      this.safe('workshops', async () => (await sources.workshops?.mine(contactId))?.map(fromWorkshop) ?? []),
      this.safe('agenda', async () => (await sources.agenda?.mineRegistrations(contactId))?.map(({ registration, event }) => fromAgenda(registration, event)) ?? []),
      this.safe('persona', async () => (await sources.persona?.allMine(contactId))?.map(fromPersona) ?? []),
      this.safe('profile', async () => {
        const profile = await sources.profiles?.mine(contactId);
        return profile ? [fromProfile(profile)] : [];
      }),
      this.safe('payments', async () => (await sources.payments?.list(contactId))?.map((payment) => fromPayment(payment, contactId)) ?? []),
      this.safe('deletion', async () => {
        const scheduled = await sources.deletion?.scheduledOf(contactId);
        return scheduled ? [fromDeletion(scheduled)] : [];
      }),
    ]);
    return parts.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async safe(source: string, read: () => Promise<MemberRequest[]>): Promise<MemberRequest[]> {
    try {
      return await read();
    } catch (error) {
      this.deps.log.error({ err: error, source }, 'requests timeline source failed');
      return [];
    }
  }
}
