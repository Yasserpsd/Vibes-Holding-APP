import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { getGuideContent } from '../content/guide.js';
import type { AppLang } from '../lang.js';
import type { Notifier } from '../mail/notify.js';
import { fromWorkshop, type RequestStatus } from '../requests/model.js';
import type { MemberNotices } from '../requests/notices.js';
import type { KV } from '../store.js';

/**
 * M10: registration for the workshops of «دليل المحايد». Open to every signed-in account —
 * the neutrals are exactly who the owner wants there («المحايد عندي رقم 1») — guests are asked
 * to sign in by the app. A registration is an interest note to the management (mail + dashboard
 * list); the timing details go back to the member by the management's own channels.
 */
export const WORKSHOP_REGISTRATIONS_KEY = 'workshops:registrations';
const MAX_REGISTRATIONS = 3000;

export type WorkshopRegistration = {
  id: string;
  workshopId: string;
  workshopTitle: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  note: string;
  createdAt: string;
  /** M138: the dashboard's status (old rows read as pending), its note, the member's language. */
  status?: RequestStatus;
  decidedAt?: string | null;
  decidedBy?: string | null;
  adminNote?: string | null;
  lang?: AppLang;
};

export type MyRegistration = Pick<WorkshopRegistration, 'id' | 'workshopId' | 'createdAt'>;

export function myRegistration(entry: WorkshopRegistration): MyRegistration {
  const { id, workshopId, createdAt } = entry;
  return { id, workshopId, createdAt };
}

type Deps = { kv: KV; notifier: Notifier; notices?: MemberNotices };

export class WorkshopsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<WorkshopRegistration[]> {
    return (await this.deps.kv.get<{ registrations: WorkshopRegistration[] }>(WORKSHOP_REGISTRATIONS_KEY))?.registrations ?? [];
  }

  private mutate<T>(change: (registrations: WorkshopRegistration[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const registrations = await this.load();
      const result = change(registrations);
      registrations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(WORKSHOP_REGISTRATIONS_KEY, { registrations: registrations.slice(0, MAX_REGISTRATIONS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async mine(contactId: number): Promise<WorkshopRegistration[]> {
    return (await this.load()).filter((entry) => entry.contactId === contactId);
  }

  async list(): Promise<WorkshopRegistration[]> {
    return this.load();
  }

  async register(me: Me, input: { workshopId: string; note?: string }, now = new Date(), lang: AppLang = 'ar'): Promise<WorkshopRegistration> {
    const guide = await getGuideContent(this.deps.kv);
    const workshop = guide.workshops.items.find((item) => item.id === input.workshopId);
    if (!workshop) throw new RequestError('not_found', 'هذه الورشة غير موجودة', 404);
    if (!workshop.open) throw new RequestError('closed', 'التسجيل في هذه الورشة مغلق حاليًا', 409);
    const registration: WorkshopRegistration = {
      id: randomUUID(),
      workshopId: workshop.id,
      workshopTitle: workshop.title,
      contactId: me.id,
      name: me.name,
      phone: me.phone,
      email: me.email,
      personaLabel: me.personaLabel,
      note: (input.note ?? '').trim(),
      createdAt: now.toISOString(),
      status: 'pending',
      lang,
    };
    await this.mutate((registrations) => {
      if (registrations.some((entry) => entry.contactId === me.id && entry.workshopId === workshop.id)) {
        throw new RequestError('already_registered', 'سجّلنا اهتمامك بهذه الورشة من قبل', 409);
      }
      registrations.push(registration);
    });
    this.deps.notifier.workshopRegistered(registration);
    // M138: the member's own receipt.
    this.deps.notices?.received(fromWorkshop(registration), { email: me.email, contactEmail: me.contactEmail, name: me.name, lang });
    return registration;
  }

  /** M138: the dashboard's status control; the member is mailed and pushed on a real change. */
  async setStatus(id: string, status: RequestStatus, adminName: string, note = '', now = new Date()): Promise<WorkshopRegistration> {
    const { entry, changed } = await this.mutate((registrations) => {
      const entry = registrations.find((registration) => registration.id === id);
      if (!entry) throw new RequestError('not_found', 'هذا التسجيل غير موجود', 404);
      const changed = (entry.status ?? 'pending') !== status;
      entry.status = status;
      entry.decidedAt = now.toISOString();
      entry.decidedBy = adminName;
      if (note.trim()) entry.adminNote = note.trim().slice(0, 300);
      return { entry, changed };
    });
    if (changed) this.deps.notices?.changed(fromWorkshop(entry), { email: entry.email, name: entry.name, lang: entry.lang });
    return entry;
  }
}
