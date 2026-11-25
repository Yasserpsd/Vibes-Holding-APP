import { hubCall, type HubClient } from '../hub/types.js';
import type { PushService } from '../push/service.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import { normalizePhone } from './phone.js';
import type { WhatsappService } from './service.js';
import { nameFor, toLang, type NoticeKind } from './templates.js';

export type TellDeps = {
  hub: HubClient;
  push: Pick<PushService, 'langOf'> & Partial<Pick<PushService, 'nameEnOf'>>;
  whatsapp?: Pick<WhatsappService, 'sendNotice' | 'enabled'>;
  /** M239: another source of the English form of an account's name; the member's own device (push.nameEnOf) is asked otherwise. */
  englishName?: (contactId: number) => Promise<string | null>;
};

/** M239 (owner, 2026-11-14): the name an English notice may carry — English form, else none (never Arabic script). */
async function nameIn(deps: TellDeps, contactId: number, name: string | null | undefined, lang: string | null | undefined): Promise<string | null> {
  if (toLang(lang) !== 'en') return name ?? null;
  const source = deps.englishName ?? ((id: number) => deps.push.nameEnOf?.(id) ?? Promise.resolve(null));
  const english = await source(contactId).catch(() => null);
  return nameFor(name, 'en', english) || null;
}

/**
 * M235: one WhatsApp notice to an account known only by its id. The number and the name are the hub's (rule 2); the
 * language is the one his app runs in now, else the one he registered with. Never throws and never holds up the caller.
 */
export async function tellMember(deps: TellDeps, contactId: number, kind: NoticeKind, values: (string | number | null | undefined)[] = [], ref?: string): Promise<void> {
  try {
    if (!deps.whatsapp?.enabled) return;
    const { contact } = await deps.hub.call('member_status', { contact_id: contactId });
    if (!contact || contact.id !== contactId || !String(contact.phone ?? '').trim()) return;
    const lang = (await deps.push.langOf(contactId).catch(() => null)) ?? contact.lang ?? null;
    await deps.whatsapp.sendNotice(kind, { phone: contact.phone, lang, name: await nameIn(deps, contactId, contact.name, lang), ref }, values);
  } catch {
    // The message in the app and its notification already went out.
  }
}

/**
 * M273: does this account of the hub's registry belong to a broadcast's audience? Only verified accounts (member, unpaid,
 * expired), never an honorary one (M232); `persona` narrows to one category, `paid` to whoever holds an active
 * membership («دفع») or does not («لم يدفع»: never paid, or expired). One rule for WhatsApp and for the dashboard's count.
 */
export function accountInAudience(account: { state?: unknown; honorary?: unknown; persona?: unknown; partner?: unknown }, persona: string | null, paid: 'paid' | 'unpaid' | null = null, partners = false): boolean {
  if (account.state !== 'member' && account.state !== 'unpaid' && account.state !== 'expired') return false;
  if (account.honorary === 1) return false;
  // M275: «شركاء النجاح» — only an account whose Success Partners membership is running.
  if (partners && account.partner !== 1) return false;
  if (persona && account.persona !== persona) return false;
  return !paid || (account.state === 'member') === (paid === 'paid');
}

/** One broadcast never sends more than this: the number's daily limit at Meta is 2,000 and the rest of the day needs room. */
export const BROADCAST_CAP = 1500;

/**
 * M236 (owner, 2026-11-14: «نعم، للجميع»): a management message for everyone, or for one category, is announced on
 * WhatsApp to every verified account that fits (the hub's registry, rule 2) — never to an honorary member (M232), an
 * unverified sign-up or a lead. Each account hears it once (`ref`), in the language its app runs in (Arabic when it has
 * no device here). Meta bills every one of these messages. Runs in the background and never throws.
 */
export async function tellAudience(deps: TellDeps & { log?: { info: (data: object, text: string) => void; warn: (data: object, text: string) => void } }, input: { uuid: string; persona: string | null; /** M273 */ paid?: 'paid' | 'unpaid' | null; /** M275 */ partners?: boolean; ref: string }): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  try {
    if (!deps.whatsapp?.enabled) return out;
    const seen = new Set<string>();
    for (let page = 1; page <= 50 && out.sent < BROADCAST_CAP; page += 1) {
      const slice = await hubCall(deps.hub, 'admin_accounts', { uuid: input.uuid, q: '', state: 'all', page, per_page: 100 });
      for (const account of slice.items) {
        const phone = String(account.phone ?? '').trim();
        const fits = accountInAudience(account, input.persona, input.paid ?? null, input.partners ?? false);
        if (!fits || !phone || seen.has(phone) || out.sent >= BROADCAST_CAP) {
          out.skipped += 1;
          continue;
        }
        seen.add(phone);
        // M242: an account with no device here was always told in Arabic. It falls back to the language it
        // registered with, when the hub's row carries it — the same rule tellMember follows for one account.
        const stored = (account as { lang?: unknown }).lang;
        const lang = (await deps.push.langOf(account.id).catch(() => null)) ?? (stored === 'en' || stored === 'ar' ? stored : null);
        const result = await deps.whatsapp.sendNotice('admin_message', { phone, lang, name: await nameIn(deps, account.id, account.name, lang), ref: `${input.ref}:${account.id}` });
        if (result.channel === 'whatsapp' && result.error !== 'already_sent') out.sent += 1;
        else out.skipped += 1;
      }
      if (slice.items.length === 0 || page * slice.per_page >= slice.total) break;
    }
    deps.log?.info({ ref: input.ref, ...out }, 'management message announced on whatsapp');
  } catch (error) {
    deps.log?.warn({ ref: input.ref, ...out, err: error instanceof Error ? error.message : 'error' }, 'whatsapp announcement stopped early');
  }
  return out;
}

/** M269: a WhatsApp reminder stays inside the day — nothing between 22:00 and 08:00 Riyadh. */
export function quietHour(ms: number): boolean {
  const hour = riyadhHour(ms);
  return hour >= 22 || hour < 8;
}

export type RemindDeps = Omit<TellDeps, 'whatsapp'> & {
  whatsapp?: Pick<WhatsappService, 'sendNotice' | 'enabled' | 'toldToday'>;
  log?: { info: (data: object, text: string) => void; warn: (data: object, text: string) => void };
};
export type RemindInput = { uuid: string; persona: string | null; /** M273 */ paid?: 'paid' | 'unpaid' | null; /** M275 */ partners?: boolean; members: number[]; done: ReadonlySet<number>; ref: string; now?: number };

/**
 * M269 (owner, 2026-11-23): the dashboard's «إرسال تذكير» — WhatsApp says again that a management message waits, only
 * to the accounts of its audience that did not open it (a poll: did not vote). The number is protected («حد ارسال يومي
 * مرة واحدة بس»): an account, or a number, that already heard a management notice today — the first announcement or
 * another reminder — hears nothing more until tomorrow; one reminder never passes BROADCAST_CAP, never goes out at
 * night, and the same reminder is never sent twice in a day (`ref`). Runs in the background and never throws.
 */
export async function remindAudience(deps: RemindDeps, input: RemindInput): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  try {
    const whatsapp = deps.whatsapp;
    const now = input.now ?? Date.now();
    if (!whatsapp?.enabled || quietHour(now)) return out;
    const told = await whatsapp.toldToday('admin_message', now);
    const day = riyadhDay(now);
    const tell = async (account: { id: number; phone?: unknown; name?: string | null; lang?: unknown }) => {
      const raw = String(account.phone ?? '').trim();
      const phone = normalizePhone(raw);
      if (!phone || input.done.has(account.id) || told.accounts.has(account.id) || told.phones.has(phone) || out.sent >= BROADCAST_CAP) {
        out.skipped += 1;
        return;
      }
      told.accounts.add(account.id);
      told.phones.add(phone);
      const stored = account.lang;
      const lang = (await deps.push.langOf(account.id).catch(() => null)) ?? (stored === 'en' || stored === 'ar' ? stored : null);
      const result = await whatsapp.sendNotice('admin_message', { phone: raw, lang, name: await nameIn(deps, account.id, account.name, lang), ref: `${input.ref}:${account.id}:r${day}` });
      if (result.channel === 'whatsapp' && result.error !== 'already_sent') out.sent += 1;
      else out.skipped += 1;
    };
    if (input.members.length) {
      for (const contactId of input.members) {
        const contact = await deps.hub.call('member_status', { contact_id: contactId }).then((found) => found.contact, () => null);
        if (contact && contact.id === contactId) await tell(contact);
        else out.skipped += 1;
      }
    } else {
      for (let page = 1; page <= 50 && out.sent < BROADCAST_CAP; page += 1) {
        const slice = await hubCall(deps.hub, 'admin_accounts', { uuid: input.uuid, q: '', state: 'all', page, per_page: 100 });
        for (const account of slice.items) {
          const fits = accountInAudience(account, input.persona, input.paid ?? null, input.partners ?? false);
          if (fits) await tell(account);
          else out.skipped += 1;
        }
        if (slice.items.length === 0 || page * slice.per_page >= slice.total) break;
      }
    }
    deps.log?.info({ ref: input.ref, ...out }, 'management message reminder on whatsapp');
  } catch (error) {
    deps.log?.warn({ ref: input.ref, ...out, err: error instanceof Error ? error.message : 'error' }, 'whatsapp reminder stopped early');
  }
  return out;
}
