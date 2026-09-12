import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { HubError, type HubClient } from '../hub/types.js';
import type { ActivationLike, Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';

/**
 * Annual membership purchases come only from the stores (Apple IAP / Google Play Billing through
 * RevenueCat, CLAUDE.md rule 3). RevenueCat's webhook reaches this server, which activates the
 * membership in the hub (`activate_member`, plugin op pending) and tells the management by e-mail.
 * The app's own purchase result is never trusted for activation (the same idea as rule 5).
 */
export const PURCHASES_KEY = 'membership:purchases';
const KEEP = 500;
const ACTIVATING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
const DEFAULT_DAYS = 365;

/** App user id the app registers with RevenueCat: `vc-<hub contact id>` (a bare number is accepted too). */
export function parseAppUserId(value: string): number | null {
  const match = /^(?:vc-)?(\d{1,12})$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

const eventSchema = z.object({
  api_version: z.string().optional(),
  event: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    product_id: z.string().default(''),
    store: z.string().default(''),
    environment: z.string().default(''),
    purchased_at_ms: z.number().optional().nullable(),
    expiration_at_ms: z.number().optional().nullable(),
    transaction_id: z.string().optional().nullable(),
    original_transaction_id: z.string().optional().nullable(),
  }),
});

export type PurchaseEvent = {
  id: string;
  type: string;
  appUserId: string;
  contactId: number | null;
  productId: string;
  store: string;
  environment: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  transactionId: string | null;
  days: number;
  receivedAt: string;
  activation: 'activated' | 'pending' | 'ignored' | 'skipped';
  reason: string | null;
};

type Deps = { kv: KV; log: FastifyBaseLogger; hub: HubClient; auth: AuthService; notifier: Notifier; appEnv: 'test' | 'production' };

export class MembershipService {
  private chain: Promise<unknown> = Promise.resolve();
  private known = 0;

  constructor(private readonly deps: Deps) {}

  status(): { events: number } {
    return { events: this.known };
  }

  private record(event: PurchaseEvent): Promise<void> {
    const run = this.chain.then(async () => {
      const stored = (await this.deps.kv.get<{ events: PurchaseEvent[] }>(PURCHASES_KEY))?.events ?? [];
      if (!stored.some((entry) => entry.id === event.id)) stored.push(event);
      const kept = stored.slice(-KEEP);
      await this.deps.kv.set(PURCHASES_KEY, { events: kept });
      this.known = kept.length;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<PurchaseEvent[]> {
    const stored = (await this.deps.kv.get<{ events: PurchaseEvent[] }>(PURCHASES_KEY))?.events ?? [];
    return [...stored].reverse();
  }

  /** RevenueCat webhook body → hub activation. Unknown or non-purchase events are recorded and ignored. */
  async handleRevenueCat(payload: unknown, now = Date.now()): Promise<PurchaseEvent> {
    const parsed = eventSchema.safeParse(payload);
    if (!parsed.success) throw new RequestError('invalid', 'unexpected webhook body', 400);
    const { event } = parsed.data;
    const purchasedAt = event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : null;
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
    const span = event.expiration_at_ms && event.purchased_at_ms ? Math.round((event.expiration_at_ms - event.purchased_at_ms) / 86_400_000) : 0;
    const days = span > 0 ? Math.min(span, 400) : DEFAULT_DAYS;
    const contactId = parseAppUserId(event.app_user_id);
    const base: PurchaseEvent = {
      id: event.id,
      type: event.type,
      appUserId: event.app_user_id,
      contactId,
      productId: event.product_id,
      store: event.store,
      environment: event.environment,
      purchasedAt,
      expiresAt,
      transactionId: event.transaction_id ?? event.original_transaction_id ?? null,
      days,
      receivedAt: new Date(now).toISOString(),
      activation: 'ignored',
      reason: null,
    };

    let outcome: PurchaseEvent;
    if (!ACTIVATING.has(event.type)) {
      outcome = { ...base, activation: 'ignored', reason: `event ${event.type} does not activate` };
    } else if (contactId === null) {
      outcome = { ...base, activation: 'pending', reason: 'unknown app user id' };
    } else if (event.environment === 'SANDBOX' && this.deps.appEnv === 'production') {
      outcome = { ...base, activation: 'skipped', reason: 'sandbox purchase in production' };
    } else {
      outcome = await this.activate(base, contactId);
    }
    await this.record(outcome);
    this.deps.log.info({ event: event.id, type: event.type, activation: outcome.activation, reason: outcome.reason }, 'store purchase event');
    return outcome;
  }

  private async activate(event: PurchaseEvent, contactId: number): Promise<PurchaseEvent> {
    const reference = event.transactionId ?? event.id;
    const mail: ActivationLike = {
      contactId,
      name: `عضو رقم ${contactId}`,
      email: '',
      phone: '',
      productId: event.productId,
      store: event.store,
      reference,
      days: event.days,
      expiresAt: event.expiresAt,
      environment: event.environment,
    };
    try {
      const result = await this.deps.hub.call('activate_member', {
        contact_id: contactId,
        days: event.days,
        reference,
        product: event.productId,
        store: event.store,
      });
      if (result.contact) {
        mail.name = result.contact.name || mail.name;
        mail.email = result.contact.email;
        mail.phone = result.contact.phone;
      }
      this.deps.auth.forget(contactId);
      this.deps.notifier.membershipActivated(mail);
      return { ...event, activation: 'activated', reason: null };
    } catch (error) {
      const reason = error instanceof HubError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'hub error';
      this.deps.log.error({ err: error, contactId }, 'membership activation failed; manual activation needed');
      this.deps.notifier.membershipActivationPending(mail, reason);
      return { ...event, activation: 'pending', reason };
    }
  }
}
