import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { RequestError } from '../auth/guard.js';
import type { AuthService, Me } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import { HubError, type HubClient } from '../hub/types.js';
import type { InvitesService } from '../invites/service.js';
import type { ActivationLike, Notifier } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import { lastRiyadhDays, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * Annual membership purchases come only from the stores (Apple IAP / Google Play Billing through
 * RevenueCat, CLAUDE.md rule 3). RevenueCat's webhook reaches this server, which activates the
 * membership in the hub (`activate_member`, plugin op pending) and tells the management by e-mail.
 * The app's own purchase result is never trusted for activation (the same idea as rule 5): after a
 * purchase the app calls `sync`, which asks RevenueCat's REST API when the secret key is set.
 */
export const PURCHASES_KEY = 'membership:purchases';
export const APP_USER_PREFIX = 'vc-';
const KEEP = 500;
const ACTIVATING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
const DEFAULT_DAYS = 365;
const MAX_DAYS = 400;
const REVENUECAT_API = 'https://api.revenuecat.com/v1';

/** App user id the app registers with RevenueCat: `vc-<hub contact id>` (a bare number is accepted too). */
export function parseAppUserId(value: string): number | null {
  const match = /^(?:vc-)?(\d{1,12})$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export function appUserIdOf(contactId: number): string {
  return `${APP_USER_PREFIX}${contactId}`;
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
  activation: 'activated' | 'pending' | 'ignored' | 'skipped' | 'duplicate';
  reason: string | null;
};

/** Public store settings for the app (RevenueCat public SDK keys are meant to ship in apps). */
export type StoreConfig = {
  provider: 'revenuecat';
  productId: string;
  entitlement: string;
  apiKeys: { android: string | null; ios: string | null };
  appUserIdPrefix: string;
  environment: 'test' | 'production';
  termsUrl: string | null;
  privacyUrl: string | null;
  restCheck: boolean;
};

export type StoreSettings = {
  productId: string;
  entitlement: string;
  androidKey?: string;
  iosKey?: string;
  secretKey?: string;
  termsUrl?: string;
  privacyUrl?: string;
};

export type SyncResult = { me: Me; checked: boolean; entitlementActive: boolean | null; activation: PurchaseEvent['activation'] | 'none'; reason: string | null };

type Entitlement = { expires_date?: string | null; purchase_date?: string | null; product_identifier?: string };
type Subscription = { store?: string; is_sandbox?: boolean; store_transaction_id?: string | null };
type Subscriber = { entitlements?: Record<string, Entitlement>; subscriptions?: Record<string, Subscription> };

function findSubscription(subscriber: Subscriber, productId: string): Subscription | null {
  const subscriptions = subscriber.subscriptions ?? {};
  // Play products may be keyed `product:basePlan`.
  return subscriptions[productId] ?? Object.entries(subscriptions).find(([key]) => key.startsWith(`${productId}:`))?.[1] ?? null;
}

type Deps = {
  kv: KV;
  log: FastifyBaseLogger;
  hub: HubClient;
  auth: AuthService;
  notifier: Notifier;
  push: PushService;
  appEnv: 'test' | 'production';
  store: StoreSettings;
  fetchImpl?: typeof fetch;
  /** M32: marks the invitee «فعّل العضوية» on the invitations list. */
  invites?: InvitesService;
};

export class MembershipService {
  private chain: Promise<unknown> = Promise.resolve();
  private known = 0;

  constructor(private readonly deps: Deps) {}

  status(): { events: number; store: { android: boolean; ios: boolean; product: string; entitlement: string; restCheck: boolean } } {
    const { store } = this.deps;
    return { events: this.known, store: { android: Boolean(store.androidKey), ios: Boolean(store.iosKey), product: store.productId, entitlement: store.entitlement, restCheck: Boolean(store.secretKey) } };
  }

  storeConfig(): StoreConfig {
    const { store } = this.deps;
    return {
      provider: 'revenuecat',
      productId: store.productId,
      entitlement: store.entitlement,
      apiKeys: { android: store.androidKey ?? null, ios: store.iosKey ?? null },
      appUserIdPrefix: APP_USER_PREFIX,
      environment: this.deps.appEnv,
      termsUrl: store.termsUrl ?? null,
      privacyUrl: store.privacyUrl ?? null,
      restCheck: Boolean(store.secretKey),
    };
  }

  private async stored(): Promise<PurchaseEvent[]> {
    const events = (await this.deps.kv.get<{ events: PurchaseEvent[] }>(PURCHASES_KEY))?.events ?? [];
    this.known = events.length;
    return events;
  }

  private record(event: PurchaseEvent): Promise<void> {
    const run = this.chain.then(async () => {
      const stored = await this.stored();
      const index = stored.findIndex((entry) => entry.id === event.id);
      if (index >= 0) stored[index] = event;
      else stored.push(event);
      const kept = stored.slice(-KEEP);
      await this.deps.kv.set(PURCHASES_KEY, { events: kept });
      this.known = kept.length;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<PurchaseEvent[]> {
    return [...(await this.stored())].reverse();
  }

  /** Dashboard home: store purchases and renewals per Riyadh day (events that reached the hub or wait for it). */
  async dailyStats(days: number, now = Date.now()): Promise<{ series: { day: string; purchases: number; renewals: number }[] }> {
    const series = new Map(lastRiyadhDays(days, now).map((day) => [day, { day, purchases: 0, renewals: 0 }]));
    for (const event of await this.stored()) {
      if (event.activation !== 'activated' && event.activation !== 'pending') continue;
      const row = series.get(riyadhDay(Date.parse(event.receivedAt)));
      if (!row) continue;
      if (event.type === 'RENEWAL') row.renewals += 1;
      else row.purchases += 1;
    }
    return { series: [...series.values()] };
  }

  /** RevenueCat webhook body → hub activation. Unknown or non-purchase events are recorded and ignored; retries answer from the record. */
  async handleRevenueCat(payload: unknown, now = Date.now()): Promise<PurchaseEvent> {
    const parsed = eventSchema.safeParse(payload);
    if (!parsed.success) throw new RequestError('invalid', 'unexpected webhook body', 400);
    const { event } = parsed.data;
    const known = (await this.stored()).find((entry) => entry.id === event.id);
    if (known && known.activation !== 'pending') {
      this.deps.log.info({ event: event.id, activation: known.activation }, 'store purchase event repeated');
      return known;
    }
    const purchasedAt = event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : null;
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
    const span = event.expiration_at_ms && event.purchased_at_ms ? Math.round((event.expiration_at_ms - event.purchased_at_ms) / 86_400_000) : 0;
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
      days: span > 0 ? Math.min(span, MAX_DAYS) : DEFAULT_DAYS,
      receivedAt: new Date(now).toISOString(),
      activation: 'ignored',
      reason: null,
    };

    let outcome: PurchaseEvent;
    if (!ACTIVATING.has(event.type)) {
      outcome = { ...base, activation: 'ignored', reason: `event ${event.type} does not activate` };
    } else if (contactId === null) {
      outcome = { ...base, activation: 'pending', reason: 'unknown app user id' };
      this.deps.notifier.membershipActivationPending(this.mailOf(base, 0), 'unknown app user id');
    } else if (event.environment === 'SANDBOX' && this.deps.appEnv === 'production') {
      outcome = { ...base, activation: 'skipped', reason: 'sandbox purchase in production' };
    } else {
      outcome = await this.activate(base, contactId);
    }
    await this.record(outcome);
    this.deps.log.info({ event: event.id, type: event.type, activation: outcome.activation, reason: outcome.reason }, 'store purchase event');
    return outcome;
  }

  /**
   * The app calls this after a purchase or restore. The cached account is dropped so /api/me shows
   * the webhook's activation; with the REST key the entitlement is read from RevenueCat directly
   * and activated when the webhook has not done it yet (late or missing webhook).
   */
  async sync(session: SessionRecord, now = Date.now()): Promise<SyncResult> {
    const contactId = session.contactId;
    this.deps.auth.forget(contactId);
    if (!this.deps.store.secretKey) {
      return { me: await this.deps.auth.me(session, true), checked: false, entitlementActive: null, activation: 'none', reason: null };
    }
    const subscriber = await this.fetchSubscriber(contactId);
    const entitlement = subscriber?.entitlements?.[this.deps.store.entitlement];
    const expiresMs = entitlement?.expires_date ? Date.parse(entitlement.expires_date) : null;
    const active = Boolean(entitlement) && (expiresMs === null || Number.isNaN(expiresMs) || expiresMs > now);
    let activation: SyncResult['activation'] = 'none';
    let reason: string | null = null;
    if (subscriber && entitlement && active) {
      const productId = entitlement.product_identifier ?? this.deps.store.productId;
      const subscription = findSubscription(subscriber, productId);
      const purchasedMs = entitlement.purchase_date ? Date.parse(entitlement.purchase_date) : null;
      const span = expiresMs && purchasedMs ? Math.round((expiresMs - purchasedMs) / 86_400_000) : 0;
      const event: PurchaseEvent = {
        id: `sync:${contactId}:${entitlement.expires_date ?? entitlement.purchase_date ?? 'lifetime'}`,
        type: 'SYNC',
        appUserId: appUserIdOf(contactId),
        contactId,
        productId,
        store: (subscription?.store ?? 'unknown').toUpperCase(),
        environment: subscription?.is_sandbox ? 'SANDBOX' : 'PRODUCTION',
        purchasedAt: purchasedMs && !Number.isNaN(purchasedMs) ? new Date(purchasedMs).toISOString() : null,
        expiresAt: expiresMs && !Number.isNaN(expiresMs) ? new Date(expiresMs).toISOString() : null,
        transactionId: subscription?.store_transaction_id ?? null,
        days: span > 0 ? Math.min(span, MAX_DAYS) : DEFAULT_DAYS,
        receivedAt: new Date(now).toISOString(),
        activation: 'ignored',
        reason: null,
      };
      const known = (await this.stored()).find((entry) => entry.id === event.id && entry.activation !== 'pending');
      let outcome: PurchaseEvent;
      if (known) outcome = known;
      else if (event.environment === 'SANDBOX' && this.deps.appEnv === 'production') outcome = { ...event, activation: 'skipped', reason: 'sandbox purchase in production' };
      else outcome = await this.activate(event, contactId);
      if (!known) await this.record(outcome);
      activation = outcome.activation;
      reason = outcome.reason;
      this.deps.auth.forget(contactId);
    }
    this.deps.log.info({ contactId, active, activation, reason }, 'store membership sync');
    return { me: await this.deps.auth.me(session, true), checked: true, entitlementActive: active, activation, reason };
  }

  private async fetchSubscriber(contactId: number): Promise<Subscriber | null> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${REVENUECAT_API}/subscribers/${encodeURIComponent(appUserIdOf(contactId))}`, {
        headers: { authorization: `Bearer ${this.deps.store.secretKey}`, accept: 'application/json' },
      });
    } catch (error) {
      this.deps.log.error({ err: error, contactId }, 'revenuecat subscriber request failed');
      throw new RequestError('store_unavailable', 'تعذّر التحقق من الاشتراك الآن، حاول بعد قليل', 502);
    }
    if (!response.ok) {
      this.deps.log.warn({ contactId, status: response.status }, 'revenuecat subscriber request refused');
      throw new RequestError('store_unavailable', 'تعذّر التحقق من الاشتراك الآن، حاول بعد قليل', 502);
    }
    const body = (await response.json()) as { subscriber?: Subscriber };
    return body.subscriber ?? null;
  }

  private mailOf(event: PurchaseEvent, contactId: number): ActivationLike {
    return {
      contactId,
      name: contactId ? `عضو رقم ${contactId}` : `مستخدم المتجر ${event.appUserId}`,
      email: '',
      phone: '',
      productId: event.productId,
      store: event.store,
      reference: event.transactionId ?? event.id,
      days: event.days,
      expiresAt: event.expiresAt,
      environment: event.environment,
    };
  }

  private async activate(event: PurchaseEvent, contactId: number): Promise<PurchaseEvent> {
    // One purchase can reach the server twice (a webhook retry, or the app's sync next to the webhook): one activation per expiry or transaction.
    const earlier = (await this.stored()).find(
      (entry) =>
        entry.contactId === contactId &&
        entry.activation === 'activated' &&
        entry.id !== event.id &&
        ((event.expiresAt !== null && entry.expiresAt === event.expiresAt) || (event.transactionId !== null && entry.transactionId === event.transactionId)),
    );
    if (earlier) return { ...event, activation: 'duplicate', reason: `already activated by ${earlier.id}` };
    const mail = this.mailOf(event, contactId);
    try {
      const result = await this.deps.hub.call('activate_member', {
        contact_id: contactId,
        days: event.days,
        reference: mail.reference,
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
      this.deps.push.membershipActivated(contactId, { expiresAt: event.expiresAt, pending: false });
      if (this.deps.invites) await this.deps.invites.onActivated(contactId);
      return { ...event, activation: 'activated', reason: null };
    } catch (error) {
      const reason = error instanceof HubError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'hub error';
      this.deps.log.error({ err: error, contactId }, 'membership activation failed; manual activation needed');
      this.deps.notifier.membershipActivationPending(mail, reason);
      this.deps.push.membershipActivated(contactId, { expiresAt: event.expiresAt, pending: true });
      return { ...event, activation: 'pending', reason };
    }
  }
}
