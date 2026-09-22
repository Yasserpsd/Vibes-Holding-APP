import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import { membershipNumber } from '../auth/service.js';
import { hubCall, type HubClient, type HubContact } from '../hub/types.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';

/**
 * M32: «الدعوات» — a member shares his membership number as an invite code. The code travels with
 * the hub registration (`referral`) and the HUB itself resolves and stores it on the new contact
 * (`referred_by`, plugin 2.7.2) — never trusted from the client alone. What lives here is the
 * management's working list: who registered through whom, and whether the administration's gift
 * (the owner decides it each time: a discount code, the founder's book…) was delivered. The gift
 * is manual by the owner's word of 2026-09-23; the dashboard only records it.
 */
export const INVITES_KEY = 'invites:registrations';
export const INVITES_CONFIG_KEY = 'invites:config';
const MAX_INVITES = 2000;
/** The first hub plugin that understands `referral` on register. */
const REFERRAL_HUB_VERSION = [2, 7, 2] as const;
const PING_CACHE_MS = 10 * 60_000;

export type InviteGift = { note: string; doneAt: string; doneBy: string };

export type InviteRecord = {
  id: string;
  /** The new account, as the hub answered at registration time. */
  inviteeId: number;
  inviteeName: string;
  inviteePhone: string;
  inviteeEmail: string;
  /** The member whose code was used, resolved by the hub. */
  inviterId: number;
  inviterName: string;
  inviterNumber: string;
  /** The code exactly as the invitee sent it (normalized). */
  code: string;
  createdAt: string;
  verifiedAt: string | null;
  activatedAt: string | null;
  gift: InviteGift | null;
};

export type InvitesConfig = { giftText: string; shareText: string };

/** Server-driven wording (UI rule: the owner edits marketing copy from the dashboard). */
export const DEFAULT_INVITES_CONFIG: InvitesConfig = {
  giftText: 'كل من يسجّل بكود دعوتك يحصل على هدية من إدارة النادي بعد تفعيل حسابه، والإدارة تتواصل معه مباشرةً لتسليمها.',
  shareText:
    'أدعوك للانضمام إلى نادي المستثمرين — مجتمع أعمال وشراكات وخدمات لروّاد الأعمال والمستثمرين. سجّل في التطبيق واكتب كود الدعوة {code} في خانة «كود الدعوة» أثناء التسجيل، ولك هدية من إدارة النادي بعد تفعيل حسابك.',
};

/** What the inviter sees about his own nominees in the app. */
export type PublicInvitee = { name: string; at: string; state: 'registered' | 'verified' | 'member' };

export function publicInvitee(record: InviteRecord): PublicInvitee {
  return {
    name: record.inviteeName,
    at: record.createdAt,
    state: record.activatedAt ? 'member' : record.verifiedAt ? 'verified' : 'registered',
  };
}

const easternDigit = (digit: string): string => {
  const arabic = digit.charCodeAt(0) - 0x0660;
  return String(arabic >= 0 && arabic <= 9 ? arabic : digit.charCodeAt(0) - 0x06f0);
};

/**
 * The code as members pass it around: the membership number of M30 (`I-0000000042`), tolerated
 * with Arabic digits, spaces, a missing dash or a missing letter. Null when it cannot be a code.
 */
export function normalizeInviteCode(raw: string): string | null {
  const western = raw.replace(/[٠-٩۰-۹]/g, easternDigit);
  const match = western.toUpperCase().replace(/[\s._–—]+/g, '').match(/^([A-Z])?-?(\d{1,12})$/);
  if (!match) return null;
  return `${match[1] ?? ''}${match[1] ? '-' : ''}${match[2]}`;
}

type Deps = { kv: KV; hub: HubClient; notifier: Notifier; log: FastifyBaseLogger };

export class InvitesService {
  private chain: Promise<unknown> = Promise.resolve();
  private hubSupport: { ok: boolean; at: number } | null = null;

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<InviteRecord[]> {
    return (await this.deps.kv.get<{ invites: InviteRecord[] }>(INVITES_KEY))?.invites ?? [];
  }

  private mutate<T>(change: (invites: InviteRecord[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const invites = await this.load();
      const result = change(invites);
      invites.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(INVITES_KEY, { invites: invites.slice(0, MAX_INVITES) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async config(): Promise<InvitesConfig> {
    const stored = await this.deps.kv.get<Partial<InvitesConfig>>(INVITES_CONFIG_KEY);
    return {
      giftText: stored?.giftText?.trim() || DEFAULT_INVITES_CONFIG.giftText,
      shareText: stored?.shareText?.trim() || DEFAULT_INVITES_CONFIG.shareText,
    };
  }

  async saveConfig(input: Partial<InvitesConfig>): Promise<InvitesConfig> {
    const current = await this.config();
    const next: InvitesConfig = {
      giftText: (input.giftText ?? current.giftText).trim() || DEFAULT_INVITES_CONFIG.giftText,
      shareText: (input.shareText ?? current.shareText).trim() || DEFAULT_INVITES_CONFIG.shareText,
    };
    await this.deps.kv.set(INVITES_CONFIG_KEY, next);
    return next;
  }

  /**
   * Before the hub registration: the code must look like a membership number, and the live hub
   * must already run a plugin that stores the referral — otherwise the code would be silently
   * lost, so the invitee is told to clear it instead.
   */
  async prepare(raw: string): Promise<string> {
    const code = normalizeInviteCode(raw);
    if (!code) {
      throw new RequestError('invite_code', 'كود الدعوة غير صحيح — راجعه مع من دعاك، أو امسحه وأكمل التسجيل', 400);
    }
    if (!(await this.hubSupportsReferral())) {
      throw new RequestError('invite_unavailable', 'الدعوات غير متاحة حاليًا — امسح كود الدعوة وأكمل التسجيل، وأخبر من دعاك', 503);
    }
    return code;
  }

  private async hubSupportsReferral(): Promise<boolean> {
    if (this.deps.hub.mode === 'mock') return true;
    if (this.hubSupport && Date.now() - this.hubSupport.at < PING_CACHE_MS) return this.hubSupport.ok;
    let ok = false;
    try {
      const ping = await hubCall(this.deps.hub, 'ping', {});
      const found = String(ping.version ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
      if (found) {
        ok = compare([Number(found[1]), Number(found[2]), Number(found[3])], REFERRAL_HUB_VERSION) >= 0;
      }
    } catch (error) {
      this.deps.log.warn({ err: error }, 'invites: hub ping failed');
    }
    this.hubSupport = { ok, at: Date.now() };
    return ok;
  }

  /** After the hub accepted the registration and resolved the referral itself. */
  async recordFromRegister(contact: HubContact, referredBy: number, referredName: string, code: string, now = new Date()): Promise<void> {
    if (!referredBy || referredBy === contact.id) return;
    const record: InviteRecord = {
      id: randomUUID(),
      inviteeId: contact.id,
      inviteeName: contact.name,
      inviteePhone: contact.phone,
      inviteeEmail: contact.email,
      inviterId: referredBy,
      inviterName: referredName,
      inviterNumber: membershipNumber({ id: referredBy, persona: '' }),
      code,
      createdAt: now.toISOString(),
      verifiedAt: null,
      activatedAt: null,
      gift: null,
    };
    // The letter of the number the inviter actually shared, when the code carried one.
    const letter = code.match(/^([A-Z])-/);
    if (letter) record.inviterNumber = `${letter[1]}-${String(referredBy).padStart(10, '0').slice(-10)}`;
    await this.mutate((invites) => {
      const existing = invites.find((entry) => entry.inviteeId === contact.id);
      // A pending account may register again (typo in the first try) — the last code wins until verified.
      if (existing && !existing.verifiedAt) invites.splice(invites.indexOf(existing), 1);
      else if (existing) return;
      invites.push(record);
    });
  }

  /** The invitee confirmed his e-mail: the invitation is real — tell the management once. Never breaks the sign-in. */
  async onVerified(contact: HubContact, now = new Date()): Promise<void> {
    try {
      const mailed = await this.mutate((invites) => {
        const record = invites.find((entry) => entry.inviteeId === contact.id);
        if (!record || record.verifiedAt) return null;
        record.verifiedAt = now.toISOString();
        record.inviteeName = contact.name || record.inviteeName;
        record.inviteeEmail = contact.email || record.inviteeEmail;
        record.inviteePhone = contact.phone || record.inviteePhone;
        return { ...record };
      });
      if (mailed) this.deps.notifier.inviteVerified(mailed);
    } catch (error) {
      this.deps.log.error({ err: error }, 'invites: onVerified failed');
    }
  }

  /** The invitee went on and activated the annual membership. */
  async onActivated(contactId: number, now = new Date()): Promise<void> {
    try {
      await this.mutate((invites) => {
        const record = invites.find((entry) => entry.inviteeId === contactId);
        if (record && !record.activatedAt) record.activatedAt = now.toISOString();
      });
    } catch (error) {
      this.deps.log.error({ err: error }, 'invites: onActivated failed');
    }
  }

  /** The inviter's own nominees, newest first. */
  async mine(inviterId: number): Promise<PublicInvitee[]> {
    return (await this.load()).filter((record) => record.inviterId === inviterId).map(publicInvitee);
  }

  async list(): Promise<InviteRecord[]> {
    return this.load();
  }

  /** The dashboard records what the administration handed over («تم تسليم الهدية»). */
  async markGift(id: string, note: string, adminName: string, now = new Date()): Promise<InviteRecord | null> {
    return this.mutate((invites) => {
      const record = invites.find((entry) => entry.id === id);
      if (!record) return null;
      if (!record.gift) record.gift = { note: note.trim(), doneAt: now.toISOString(), doneBy: adminName };
      return { ...record };
    });
  }
}

function compare(a: number[], b: readonly number[]): number {
  for (let i = 0; i < b.length; i += 1) {
    const [left, right] = [a[i] ?? 0, b[i] ?? 0];
    if (left !== right) return left - right;
  }
  return 0;
}
