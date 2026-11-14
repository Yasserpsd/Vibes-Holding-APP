import { hubCall, type HubClient } from '../hub/types.js';
import type { PushService } from '../push/service.js';
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

/** One broadcast never sends more than this: the number's daily limit at Meta is 2,000 and the rest of the day needs room. */
export const BROADCAST_CAP = 1500;

/**
 * M236 (owner, 2026-11-14: «نعم، للجميع»): a management message for everyone, or for one category, is announced on
 * WhatsApp to every verified account that fits (the hub's registry, rule 2) — never to an honorary member (M232), an
 * unverified sign-up or a lead. Each account hears it once (`ref`), in the language its app runs in (Arabic when it has
 * no device here). Meta bills every one of these messages. Runs in the background and never throws.
 */
export async function tellAudience(deps: TellDeps & { log?: { info: (data: object, text: string) => void; warn: (data: object, text: string) => void } }, input: { uuid: string; persona: string | null; ref: string }): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  try {
    if (!deps.whatsapp?.enabled) return out;
    const seen = new Set<string>();
    for (let page = 1; page <= 50 && out.sent < BROADCAST_CAP; page += 1) {
      const slice = await hubCall(deps.hub, 'admin_accounts', { uuid: input.uuid, q: '', state: 'all', page, per_page: 100 });
      for (const account of slice.items) {
        const phone = String(account.phone ?? '').trim();
        const fits = (account.state === 'member' || account.state === 'unpaid' || account.state === 'expired') && account.honorary !== 1 && (!input.persona || account.persona === input.persona);
        if (!fits || !phone || seen.has(phone) || out.sent >= BROADCAST_CAP) {
          out.skipped += 1;
          continue;
        }
        seen.add(phone);
        const lang = await deps.push.langOf(account.id).catch(() => null);
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
