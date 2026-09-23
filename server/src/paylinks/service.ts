import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AuthService } from '../auth/service.js';
import { hubCall, HubError, type HubClient } from '../hub/types.js';
import type { InvitesService } from '../invites/service.js';
import type { Notifier } from '../mail/notify.js';
import type { Payment, PaymentsService } from '../payments/service.js';
import type { PushService } from '../push/service.js';
import type { KV } from '../store.js';

/**
 * M44 «روابط الدفع» (owner, 2026-09-23, with the hub's «دفعة ناجحة بمبلغ غير معروف… NA NA» mail:
 * «محتاج طريقة تربط بايموب بينا مباشر بحيث يتم التفعيل فوري… واعرف اللي دفع ده من الورشة ولا عضوية»).
 * The owner creates a Paymob link FROM THE DASHBOARD with the sale's kind, label and customer; the
 * customer pays it anywhere (WhatsApp…); our HMAC webhook settles it (rule 5), the mail says exactly
 * what and who — and a MEMBERSHIP sale activates the matched hub account by itself, instantly.
 * Dashboard-only: nothing of this ever appears inside the app (rule 3).
 */
export const PAYLINKS_KEY = 'payments:links';
const MAX_LINKS = 2000;

export type PayLinkKind = 'membership' | 'workshop' | 'other';

export const KIND_LABEL: Record<PayLinkKind, string> = { membership: 'عضوية سنوية', workshop: 'ورشة / فعالية', other: 'أخرى' };

export type PayLink = {
  id: string;
  kind: PayLinkKind;
  label: string;
  amountSar: number;
  /** Membership sales only: how many days the activation grants. */
  days: number | null;
  /** The matched hub account (by the customer's phone/e-mail) that a membership sale activates. */
  contactId: number | null;
  contactName: string;
  customer: { name: string; phone: string; email: string };
  paymentId: string;
  checkoutUrl: string;
  createdBy: string;
  createdAt: string;
  paidAt: string | null;
  /** auto = واقف مستني الدفع؛ done = العضوية اتفعّلت؛ failed = الدفع تم والتفعيل محتاج مراجعة؛ none = بيع بلا تفعيل. */
  activation: 'auto' | 'done' | 'failed' | 'none';
  activationNote: string | null;
};

export type PayLinkInput = {
  kind: PayLinkKind;
  label: string;
  amountSar: number;
  days: number;
  customer: { name: string; phone: string; email: string };
};

type Deps = { kv: KV; hub: HubClient; payments: PaymentsService; notifier: Notifier; push: PushService; auth: AuthService; invites?: InvitesService; log: FastifyBaseLogger };

export class PayLinksService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<PayLink[]> {
    return (await this.deps.kv.get<{ links: PayLink[] }>(PAYLINKS_KEY))?.links ?? [];
  }

  private mutate<T>(change: (links: PayLink[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const links = await this.load();
      const result = change(links);
      links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await this.deps.kv.set(PAYLINKS_KEY, { links: links.slice(0, MAX_LINKS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The dashboard's list with each link's live payment status. */
  async list(): Promise<(PayLink & { status: 'created' | 'paid' | 'failed' })[]> {
    const links = await this.load();
    return Promise.all(
      links.map(async (link) => {
        const payment = await this.deps.payments.byId(link.paymentId);
        return { ...link, status: payment?.status ?? 'created' };
      }),
    );
  }

  /** Creates the sale: matches the hub account first (membership sales activate it on payment). */
  async create(input: PayLinkInput, adminName: string, now = Date.now()): Promise<PayLink> {
    const customer = { name: input.customer.name.trim(), phone: input.customer.phone.trim(), email: input.customer.email.trim() };
    let contactId: number | null = null;
    let contactName = '';
    if (input.kind === 'membership' && (customer.phone || customer.email)) {
      try {
        const found = await hubCall(this.deps.hub, 'member_status', { phone: customer.phone, email: customer.email });
        if (found.contact?.id) {
          contactId = found.contact.id;
          contactName = found.contact.name ?? '';
        }
      } catch (error) {
        this.deps.log.warn({ err: error }, 'paylink hub match failed; the sale stays manual-activation');
      }
    }
    const label = input.label.trim() || (input.kind === 'membership' ? `عضوية سنوية${customer.name ? ` — ${customer.name}` : ''}` : KIND_LABEL[input.kind]);
    const payment = await this.deps.payments.startLink({
      kind: input.kind,
      label,
      amountSar: input.amountSar,
      customer: { contactId: contactId ?? 0, name: customer.name || contactName || 'عميل رابط دفع', email: customer.email, phone: customer.phone },
    });
    const link: PayLink = {
      id: randomUUID(),
      kind: input.kind,
      label,
      amountSar: input.amountSar,
      days: input.kind === 'membership' ? input.days : null,
      contactId,
      contactName,
      customer,
      paymentId: payment.id,
      checkoutUrl: payment.checkoutUrl,
      createdBy: adminName,
      createdAt: new Date(now).toISOString(),
      paidAt: null,
      activation: input.kind === 'membership' ? 'auto' : 'none',
      activationNote: input.kind === 'membership' && !contactId ? 'لا يوجد حساب مطابق بالجوال أو البريد — التفعيل يدوي بعد الدفع' : null,
    };
    await this.mutate((links) => {
      links.push(link);
    });
    return link;
  }

  /** Hears every settled payment; a paid link mails its exact story and activates a matched membership sale. */
  settled(payment: Payment): void {
    if (!payment.serviceKey.startsWith('link:')) return;
    void (async () => {
      try {
        const link = (await this.load()).find((entry) => entry.paymentId === payment.id);
        if (!link) return;
        if (payment.status !== 'paid') {
          this.deps.notifier.payLinkFailed(link, payment);
          return;
        }
        if (link.paidAt) return; // a webhook retry: told once, activated once (the hub is idempotent anyway)
        await this.mutate((links) => {
          const row = links.find((entry) => entry.id === link.id);
          if (row) row.paidAt = new Date().toISOString();
        });
        let activationNote = link.activationNote;
        let activation = link.activation;
        let memberEnd = '';
        if (link.kind === 'membership' && link.contactId) {
          try {
            const result = await hubCall(this.deps.hub, 'activate_member', {
              contact_id: link.contactId,
              days: link.days ?? 365,
              reference: `paylink:${link.paymentId}`,
              product: 'paymob_link',
              store: 'PAYMOB_LINK',
            });
            activation = 'done';
            activationNote = null;
            memberEnd = result.contact?.member_end ?? '';
            this.deps.auth.forget(link.contactId);
            this.deps.push.membershipActivated(link.contactId, { expiresAt: null, pending: false });
            if (this.deps.invites) await this.deps.invites.onActivated(link.contactId);
          } catch (error) {
            activation = 'failed';
            activationNote = error instanceof HubError ? `${error.code}: ${error.message}` : 'تعذر الاتصال بالهاب — فعّل يدويًا';
            this.deps.log.error({ err: error, link: link.id }, 'paylink membership activation failed');
          }
        } else if (link.kind === 'membership') {
          activation = 'failed';
        }
        await this.mutate((links) => {
          const row = links.find((entry) => entry.id === link.id);
          if (!row) return;
          row.activation = activation;
          row.activationNote = activationNote;
        });
        this.deps.notifier.payLinkPaid({ ...link, activation, activationNote }, payment, memberEnd);
      } catch (error) {
        this.deps.log.error({ err: error, payment: payment.id }, 'paylink settlement failed');
      }
    })();
  }
}
