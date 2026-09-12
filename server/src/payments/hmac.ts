import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paymob signs its transaction callback (POST, JSON with ?hmac=) and the browser redirect (GET query)
 * with HMAC-SHA512 over these fields, concatenated in this fixed order (CLAUDE.md rule 5: the server
 * trusts a payment only after this check passes).
 */
const WEBHOOK_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parental_supervision',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

/** The redirect carries the same values as flat query parameters; the order id is `order`. */
const REDIRECT_FIELDS = WEBHOOK_FIELDS.map((field) => (field === 'order.id' ? 'order' : field));

export type Json = Record<string, unknown>;

function pick(source: Json, path: string): string {
  const value = path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Json)[key] : undefined), source);
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function webhookDigest(obj: Json, secret: string): string {
  return createHmac('sha512', secret)
    .update(WEBHOOK_FIELDS.map((field) => pick(obj, field)).join(''))
    .digest('hex');
}

export function redirectDigest(query: Record<string, string>, secret: string): string {
  return createHmac('sha512', secret)
    .update(REDIRECT_FIELDS.map((field) => query[field] ?? '').join(''))
    .digest('hex');
}

function safeEqual(expected: string, given: string): boolean {
  const left = Buffer.from(expected.toLowerCase());
  const right = Buffer.from(given.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhook(obj: Json, hmac: string | undefined, secret: string): boolean {
  return Boolean(hmac) && safeEqual(webhookDigest(obj, secret), hmac ?? '');
}

export function verifyRedirect(query: Record<string, string>, secret: string): boolean {
  const hmac = query.hmac ?? '';
  return Boolean(hmac) && safeEqual(redirectDigest(query, secret), hmac);
}

/** Flattens a callback object into the redirect's flat query shape (used by the mock gateway). */
export function toRedirectQuery(obj: Json): Record<string, string> {
  const query: Record<string, string> = {};
  for (const field of WEBHOOK_FIELDS) query[field === 'order.id' ? 'order' : field] = pick(obj, field);
  const order = obj.order as Json | undefined;
  if (order?.merchant_order_id !== undefined) query.merchant_order_id = String(order.merchant_order_id);
  const data = obj.data as Json | undefined;
  if (data?.message !== undefined) query['data.message'] = String(data.message);
  return query;
}
