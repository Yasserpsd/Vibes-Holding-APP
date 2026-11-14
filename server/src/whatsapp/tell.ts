import type { HubClient } from '../hub/types.js';
import type { PushService } from '../push/service.js';
import type { WhatsappService } from './service.js';
import type { NoticeKind } from './templates.js';

export type TellDeps = { hub: HubClient; push: Pick<PushService, 'langOf'>; whatsapp?: Pick<WhatsappService, 'sendNotice' | 'enabled'> };

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
    await deps.whatsapp.sendNotice(kind, { phone: contact.phone, lang, name: contact.name, ref }, values);
  } catch {
    // The message in the app and its notification already went out.
  }
}
