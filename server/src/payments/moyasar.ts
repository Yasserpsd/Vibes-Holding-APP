import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { Intention, IntentionInput, PaymobGateway } from './paymob.js';

/**
 * Moyasar (Saudi gateway): the server creates an INVOICE (hosted payment page) per payment and the
 * app opens its `url` exactly like the Paymob checkout. Rule 5 stays intact: the invoice callback
 * and the return page never trust the browser or the posted body — the server re-reads the invoice
 * from Moyasar's API with the secret key and only that answer settles the payment.
 */
export type MoyasarInvoiceState = {
  status: 'paid' | 'pending' | 'failed';
  /** Invoice amount in halalas (same unit as Payment.amountCents for SAR). */
  amount: number;
  transactionId: string | null;
  failureReason: string | null;
};

/** The extra ability the Moyasar gateway adds on top of the shared gateway interface. */
export interface MoyasarConfirmer {
  confirmInvoice(invoiceId: string): Promise<MoyasarInvoiceState>;
}

export type LiveMoyasarOptions = {
  baseUrl: string;
  secretKey: string;
  log: FastifyBaseLogger;
  /** Test environment only: attach the gateway status and body to the 502 so the failure can be read from the response. */
  exposeGatewayErrors?: boolean;
  fetchImpl?: typeof fetch;
};

type InvoiceJson = {
  id?: string;
  status?: string;
  amount?: number;
  url?: string;
  payments?: { id?: string; status?: string; source?: { message?: string } }[];
};

export class LiveMoyasar implements PaymobGateway, MoyasarConfirmer {
  readonly mode = 'live' as const;
  readonly provider = 'moyasar' as const;

  constructor(private readonly options: LiveMoyasarOptions) {}

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.options.secretKey}:`).toString('base64')}`;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<InvoiceJson> {
    const { baseUrl, log, exposeGatewayErrors } = this.options;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    let text = '';
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { authorization: this.authHeader, 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
      text = await response.text();
    } catch (error) {
      log.error({ err: error, path }, 'moyasar request failed');
      throw new RequestError('gateway', 'تعذّر الاتصال ببوابة الدفع، حاول بعد قليل', 502, exposeGatewayErrors ? { reason: String(error) } : undefined);
    }
    if (!response.ok) {
      log.error({ status: response.status, path, body: text.slice(0, 600) }, 'moyasar request refused');
      throw new RequestError('gateway', 'تعذّر بدء عملية الدفع، حاول بعد قليل', 502, exposeGatewayErrors ? { status: response.status, body: text.slice(0, 600) } : undefined);
    }
    try {
      return JSON.parse(text) as InvoiceJson;
    } catch {
      throw new RequestError('gateway', 'رد غير متوقع من بوابة الدفع', 502);
    }
  }

  async createIntention(input: IntentionInput): Promise<Intention> {
    const invoice = await this.call('POST', '/v1/invoices', {
      amount: input.amountCents,
      currency: input.currency,
      description: input.itemName,
      callback_url: input.notificationUrl,
      success_url: input.redirectionUrl,
      back_url: input.redirectionUrl,
      // The payer gets a generous window; after it Moyasar blocks the page and the order stays unpaid.
      expired_at: new Date(Date.now() + (input.validHours ?? 24) * 3_600_000).toISOString(),
      metadata: input.extras,
    });
    if (!invoice.id || !invoice.url) throw new RequestError('gateway', 'رد غير متوقع من بوابة الدفع', 502);
    return { intentionId: invoice.id, orderId: invoice.id, clientSecret: '', checkoutUrl: invoice.url };
  }

  /** Reads the invoice back from Moyasar (authenticated) — the only source of truth for settling. */
  async confirmInvoice(invoiceId: string): Promise<MoyasarInvoiceState> {
    const invoice = await this.call('GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
    const attempts = invoice.payments ?? [];
    const paidAttempt = attempts.find((attempt) => attempt.status === 'paid');
    const lastAttempt = attempts.at(-1);
    const status = invoice.status ?? '';
    const state: MoyasarInvoiceState['status'] =
      status === 'paid' ? 'paid' : ['expired', 'canceled', 'voided', 'failed'].includes(status) ? 'failed' : 'pending';
    return {
      status: state,
      amount: Number(invoice.amount ?? 0),
      transactionId: paidAttempt?.id ?? lastAttempt?.id ?? null,
      failureReason: state === 'failed' ? (lastAttempt?.source?.message?.slice(0, 200) ?? `invoice ${status}`) : null,
    };
  }
}

/** Which Moyasar key set is configured, read from the key prefix (sk_test_… / sk_live_…). Never exposes the key. */
export function moyasarKeyMode(secretKey: string | undefined): 'test' | 'live' | 'unknown' | null {
  if (!secretKey) return null;
  if (secretKey.startsWith('sk_test_')) return 'test';
  if (secretKey.startsWith('sk_live_')) return 'live';
  return 'unknown';
}
