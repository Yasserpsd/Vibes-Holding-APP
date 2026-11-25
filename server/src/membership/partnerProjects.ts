import type { KV } from '../store.js';

/**
 * M275 (owner, 2026-11-25): every Success Partners member is tied to one project of the Projects Bank, and a project
 * holds one partner at a time. The hub keeps the membership itself (rule 2); the tie is app data and holds the contact
 * id and the project only, never a name or a phone, so a deleted account leaves nothing personal behind here.
 */
export const PARTNER_PROJECTS_KEY = 'successPartners:projects';

/** The only project fields that leave the Projects Bank for this (rule 4). Kept so a project that leaves the feed still has its name. */
export type PartnerProject = { id: number; number: string | null; title: string };
export type PartnerLink = { contactId: number; project: PartnerProject; linkedAt: string; by: string };

export function projectLabel(project: PartnerProject): string {
  return project.number ? `${project.title} (رقم المشروع: ${project.number})` : project.title;
}

export class PartnerProjectStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KV) {}

  /**
   * One at a time (single-instance server): «is the project free» and the write that takes it are one step, so two
   * grants can never take the same project. `put` and `remove` belong inside it.
   */
  exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async all(): Promise<PartnerLink[]> {
    return (await this.kv.get<{ links: PartnerLink[] }>(PARTNER_PROJECTS_KEY))?.links ?? [];
  }

  async of(contactId: number): Promise<PartnerLink | null> {
    return (await this.all()).find((link) => link.contactId === contactId) ?? null;
  }

  /** Replaces whatever this member was tied to. */
  async put(link: PartnerLink): Promise<void> {
    const others = (await this.all()).filter((entry) => entry.contactId !== link.contactId);
    await this.kv.set(PARTNER_PROJECTS_KEY, { links: [...others, link] });
  }

  async remove(contactId: number): Promise<void> {
    const links = await this.all();
    if (!links.some((entry) => entry.contactId === contactId)) return;
    await this.kv.set(PARTNER_PROJECTS_KEY, { links: links.filter((entry) => entry.contactId !== contactId) });
  }
}
