import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { Notifier } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import type { KV } from '../store.js';

/**
 * M11 «شخصية ومسيرة»: member profiles shown at the top of the app. A member with an ACTIVE
 * annual membership applies from the app (bio, milestones, links); the admin approves, edits
 * or rejects from the dashboard and can also enter profiles by hand (2026-09-11 decision).
 * While an approved profile is being re-edited, the public keeps the last APPROVED version
 * and the new words wait in `draft` until the admin approves them.
 */
export const PROFILES_KEY = 'profiles:items';
export const PROFILES_CONFIG_KEY = 'profiles:config';
const MAX_PROFILES = 500;

export type ProfileLink = { label: string; url: string };

export type ProfileFields = {
  name: string;
  /** الوظيفة أو المنصب */
  title: string;
  company: string;
  bio: string;
  /** «محطات المسيرة» — short lines in the member's order. */
  milestones: string[];
  links: ProfileLink[];
  /** Set from the dashboard (uploads or a pasted URL); the app form cannot pick photos on the current binary. */
  photo: string | null;
};

export type ProfileStatus = 'pending' | 'approved' | 'rejected';

export type Profile = {
  id: string;
  contactId: number | null;
  memberNumber: string;
  status: ProfileStatus;
  /** The public (approved) version; for a first application it holds the submitted words while pending. */
  fields: ProfileFields;
  /** A resubmission awaiting review while `fields` stays public. */
  draft: ProfileFields | null;
  /** The admin's rejection note, shown to the member. */
  note: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type ProfilesConfig = { intro: string };

/** The owner completes his sentence from the dashboard; this is the seed. */
export const DEFAULT_PROFILES_CONFIG: ProfilesConfig = {
  intro: 'لديك الخبرات والمهارات والمؤهلات والإمكانات التي تؤهلك لتكون إحدى شخصيات نادي المستثمرين.',
};

export type PublicPerson = { id: string; name: string; title: string; company: string; photo: string | null };
export type PublicPersonFull = PublicPerson & { bio: string; milestones: string[]; links: ProfileLink[] };

export function publicPerson(profile: Profile): PublicPerson {
  const { id } = profile;
  const { name, title, company, photo } = profile.fields;
  return { id, name, title, company, photo };
}

export function publicPersonFull(profile: Profile): PublicPersonFull {
  const { bio, milestones, links } = profile.fields;
  return { ...publicPerson(profile), bio, milestones, links };
}

/** What the applying member sees about his own file. */
export type MyProfile = { id: string; status: ProfileStatus; fields: ProfileFields; draft: ProfileFields | null; note: string };

export function myProfile(profile: Profile): MyProfile {
  const { id, status, fields, draft, note } = profile;
  return { id, status, fields, draft, note };
}

export type ProfileInput = Omit<ProfileFields, 'photo' | 'name'> & { name?: string };

type Deps = { kv: KV; notifier: Notifier; push: PushService; onChange?: () => void };

export class ProfilesService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<Profile[]> {
    return (await this.deps.kv.get<{ items: Profile[] }>(PROFILES_KEY))?.items ?? [];
  }

  private mutate<T>(change: (items: Profile[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const items = await this.load();
      const result = change(items);
      await this.deps.kv.set(PROFILES_KEY, { items: items.slice(0, MAX_PROFILES) });
      this.deps.onChange?.();
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async config(): Promise<ProfilesConfig> {
    const stored = await this.deps.kv.get<Partial<ProfilesConfig>>(PROFILES_CONFIG_KEY);
    return { ...DEFAULT_PROFILES_CONFIG, ...(stored ?? {}) };
  }

  async saveConfig(patch: Partial<ProfilesConfig>): Promise<ProfilesConfig> {
    const next = { ...(await this.config()), ...patch };
    await this.deps.kv.set(PROFILES_CONFIG_KEY, next);
    this.deps.onChange?.();
    return next;
  }

  /** Approved profiles in the owner's order (order first, then the newest decision). */
  async people(): Promise<Profile[]> {
    return (await this.load())
      .filter((profile) => profile.status === 'approved')
      .sort((a, b) => a.order - b.order || (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  }

  async person(id: string): Promise<Profile | null> {
    return (await this.people()).find((profile) => profile.id === id) ?? null;
  }

  async mine(contactId: number): Promise<Profile | null> {
    return (await this.load()).find((profile) => profile.contactId === contactId) ?? null;
  }

  async listAll(): Promise<Profile[]> {
    const rank: Record<ProfileStatus, number> = { pending: 0, approved: 1, rejected: 2 };
    return (await this.load()).sort((a, b) => {
      const waiting = Number(Boolean(b.draft)) - Number(Boolean(a.draft));
      if (waiting !== 0) return waiting;
      return rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  /** The member applies (or re-applies) himself; the active annual membership is the door. */
  async apply(me: Me, input: ProfileInput, now = new Date()): Promise<Profile> {
    if (me.membership.status !== 'active') {
      throw new RequestError('membership_required', 'التقديم في «شخصية ومسيرة» متاح بعد تفعيل العضوية السنوية', 403);
    }
    const at = now.toISOString();
    const submitted: ProfileFields = {
      name: me.name,
      title: input.title.trim(),
      company: input.company.trim(),
      bio: input.bio.trim(),
      milestones: input.milestones.map((line) => line.trim()).filter(Boolean),
      links: input.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
      photo: null,
    };
    const profile = await this.mutate((items) => {
      const existing = items.find((entry) => entry.contactId === me.id);
      if (!existing) {
        const created: Profile = {
          id: randomUUID(),
          contactId: me.id,
          memberNumber: me.cardNumber,
          status: 'pending',
          fields: submitted,
          draft: null,
          note: '',
          order: 100,
          createdAt: at,
          updatedAt: at,
          decidedAt: null,
          decidedBy: null,
        };
        items.push(created);
        return created;
      }
      if (existing.status === 'approved') {
        // The public keeps the approved words; the edit waits for the admin.
        existing.draft = { ...submitted, photo: existing.fields.photo };
      } else {
        existing.status = 'pending';
        existing.fields = { ...submitted, photo: existing.fields.photo };
        existing.draft = null;
      }
      existing.note = '';
      existing.updatedAt = at;
      return existing;
    });
    this.deps.notifier.profileApplied({ name: me.name, phone: me.phone, email: me.email, memberNumber: me.cardNumber, resubmission: profile.status === 'approved' });
    return profile;
  }

  /** The dashboard enters a profile by hand: it is public at once. */
  async create(fields: ProfileFields, adminName: string, contactId: number | null = null, now = new Date()): Promise<Profile> {
    const at = now.toISOString();
    return this.mutate((items) => {
      if (contactId !== null && items.some((entry) => entry.contactId === contactId)) {
        throw new RequestError('exists', 'لهذا العضو ملف موجود بالفعل', 409);
      }
      const created: Profile = {
        id: randomUUID(),
        contactId,
        memberNumber: '',
        status: 'approved',
        fields,
        draft: null,
        note: '',
        order: 100,
        createdAt: at,
        updatedAt: at,
        decidedAt: at,
        decidedBy: adminName,
      };
      items.push(created);
      return created;
    });
  }

  /** The dashboard edits the public words directly (and the order). */
  async update(id: string, patch: Partial<ProfileFields> & { order?: number }, now = new Date()): Promise<Profile | null> {
    return this.mutate((items) => {
      const profile = items.find((entry) => entry.id === id);
      if (!profile) return null;
      const { order, ...fields } = patch;
      profile.fields = { ...profile.fields, ...fields };
      if (typeof order === 'number') profile.order = order;
      profile.updatedAt = now.toISOString();
      return profile;
    });
  }

  /** Approve makes the words public (a waiting draft replaces them); reject returns the note to the member. */
  async decide(id: string, action: 'approve' | 'reject', note: string, adminName: string, now = new Date()): Promise<Profile | null> {
    const decided = await this.mutate((items) => {
      const profile = items.find((entry) => entry.id === id);
      if (!profile) return null;
      const at = now.toISOString();
      if (action === 'approve') {
        if (profile.draft) {
          profile.fields = profile.draft;
          profile.draft = null;
        }
        profile.status = 'approved';
        profile.note = '';
      } else if (profile.draft) {
        // Rejecting a resubmission keeps the approved profile public.
        profile.draft = null;
        profile.note = note;
      } else {
        profile.status = 'rejected';
        profile.note = note;
      }
      profile.decidedAt = at;
      profile.decidedBy = adminName;
      profile.updatedAt = at;
      return profile;
    });
    if (decided?.contactId) this.deps.push.profileDecided(decided.contactId, action === 'approve', decided.id);
    return decided;
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((items) => {
      const index = items.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      items.splice(index, 1);
      return true;
    });
  }
}
