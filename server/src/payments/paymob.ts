import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';

/**
 * Paymob KSA Intention API: the server creates an intention (amount, customer, per-payment
 * notification and redirection URLs) and the app opens the unified checkout page for it in the
 * in-app browser. No card data ever touches this server or the app code.
 */
export type IntentionInput = {
  paymentId: string;
  amountCents: number;
  currency: string;
  itemName: string;
  description: string;
  customer: { firstName: string; lastName: string; email: string; phone: string };
  notificationUrl: string;
  redirectionUrl: string;
  extras: Record<string, string>;
};

export type Intention = { intentionId: string; orderId: string; clientSecret: string; checkoutUrl: string };

export interface PaymobGateway {
  readonly mode: 'live' | 'mock';
  createIntention(input: IntentionInput): Promise<Intention>;
}

export type LivePaymobOptions = {
  baseUrl: string;
  secretKey: string;
  publicKey: string;
  integrationIds: number[];
  log: FastifyBaseLogger;
  /** Test environment only: attach the gateway status and body to the 502 so the failure can be read from the response. */
  exposeGatewayErrors?: boolean;
  fetchImpl?: typeof fetch;
};

export class LivePaymob implements PaymobGateway {
  readonly mode = 'live' as const;

  constructor(private readonly options: LivePaymobOptions) {}

  async createIntention(input: IntentionInput): Promise<Intention> {
    const { baseUrl, secretKey, publicKey, integrationIds, log, exposeGatewayErrors } = this.options;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const person = {
      first_name: input.customer.firstName || 'Member',
      last_name: input.customer.lastName || 'Club',
      email: input.customer.email || 'noreply@vcmem.com',
      phone_number: input.customer.phone || '+966000000000',
    };
    const body = {
      amount: input.amountCents,
      currency: input.currency,
      payment_methods: integrationIds,
      items: [{ name: input.itemName, amount: input.amountCents, description: input.description, quantity: 1 }],
      billing_data: { ...person, apartment: 'NA', street: 'NA', building: 'NA', city: 'Riyadh', country: 'SA', floor: 'NA', state: 'NA' },
      customer: { first_name: person.first_name, last_name: person.last_name, email: person.email, extras: input.extras },
      extras: input.extras,
      special_reference: input.paymentId,
      expiration: 3600,
      notification_url: input.notificationUrl,
      redirection_url: input.redirectionUrl,
    };
    let response: Response;
    let text = '';
    try {
      response = await fetchImpl(`${baseUrl}/v1/intention/`, {
        method: 'POST',
        headers: { authorization: `Token ${secretKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      text = await response.text();
    } catch (error) {
      log.error({ err: error }, 'paymob intention request failed');
      throw new RequestError('gateway', 'تعذّر الاتصال ببوابة الدفع، حاول بعد قليل', 502, exposeGatewayErrors ? { reason: String(error) } : undefined);
    }
    if (!response.ok) {
      log.error({ status: response.status, body: text.slice(0, 600) }, 'paymob intention refused');
      throw new RequestError('gateway', 'تعذّر بدء عملية الدفع، حاول بعد قليل', 502, exposeGatewayErrors ? { status: response.status, body: text.slice(0, 600) } : undefined);
    }
    let data: { id?: string | number; intention_order_id?: string | number; client_secret?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new RequestError('gateway', 'رد غير متوقع من بوابة الدفع', 502);
    }
    if (!data.client_secret) throw new RequestError('gateway', 'رد غير متوقع من بوابة الدفع', 502);
    return {
      intentionId: String(data.id ?? ''),
      orderId: String(data.intention_order_id ?? ''),
      clientSecret: data.client_secret,
      checkoutUrl: `${baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(data.client_secret)}`,
    };
  }
}

/** Secret the mock gateway signs its callbacks with (test environment only). */
export const MOCK_HMAC_SECRET = 'mock-paymob-hmac-secret';

/** No gateway: the checkout URL is a local page that fires the same signed callback as Paymob would. */
export class MockPaymob implements PaymobGateway {
  readonly mode = 'mock' as const;
  private counter = Date.now() % 1_000_000;

  constructor(private readonly publicUrl: string) {}

  async createIntention(input: IntentionInput): Promise<Intention> {
    this.counter += 1;
    return {
      intentionId: `mock_${input.paymentId}`,
      orderId: String(this.counter),
      clientSecret: 'mock',
      checkoutUrl: `${this.publicUrl}/pay/mock/${input.paymentId}`,
    };
  }
}

export function parseIntegrationIds(value: string | undefined): number[] {
  return (value ?? '')
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

/** Which Paymob key set is configured, read from the secret key prefix (ksa_sk_test_… / ksa_sk_live_…). Never exposes the key. */
export function paymobKeyMode(secretKey: string | undefined): 'test' | 'live' | 'unknown' | null {
  if (!secretKey) return null;
  if (secretKey.includes('_test_')) return 'test';
  if (secretKey.includes('_live_')) return 'live';
  return 'unknown';
}
