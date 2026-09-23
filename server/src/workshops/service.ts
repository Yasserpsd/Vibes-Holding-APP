import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { getGuideContent } from '../content/guide.js';
import type { Notifier } from '../mail/notify.js';
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
};

export type MyRegistration = Pick<WorkshopRegistration, 'id' | 'workshopId' | 'createdAt'>;

export function myRegistration(entry: WorkshopRegistration): MyRegistration {
  const { id, workshopId, createdAt } = entry;
  return { id, workshopId, createdAt };
}

type Deps = { kv: KV; notifier: Notifier };

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

  async register(me: Me, input: { workshopId: string; note?: string }, now = new Date()): Promise<WorkshopRegistration> {
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
    };
    await this.mutate((registrations) => {
      if (registrations.some((entry) => entry.contactId === me.id && entry.workshopId === workshop.id)) {
        throw new RequestError('already_registered', 'سجّلنا اهتمامك بهذه الورشة من قبل', 409);
      }
      registrations.push(registration);
    });
    this.deps.notifier.workshopRegistered(registration);
    return registration;
  }
}
