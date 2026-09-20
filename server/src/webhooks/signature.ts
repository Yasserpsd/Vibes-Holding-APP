import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature of the hub's and Projects Bank's webhooks (docs/BRIDGE_V2.md 1.5): header `X-VAI-Timestamp` (unix seconds)
 * and `X-VAI-Signature: sha256=<hex hmac_sha256(timestamp + "." + raw_body, secret)>`. A request older or newer than
 * five minutes is refused even with a right signature, so a captured request cannot be replayed later.
 */
export const WINDOW_SECONDS = 300;

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'bad';

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function checkSignature(input: { secret: string; timestamp: string | undefined; signature: string | undefined; rawBody: string; now?: number }): SignatureCheck {
  const { secret, timestamp, signature, rawBody } = input;
  if (!timestamp || !signature) return 'missing';
  if (!/^\d{9,11}$/.test(timestamp)) return 'bad';
  // Constant-time compare, on buffers of the same length whatever was sent.
  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const given = Buffer.alloc(expected.length);
  given.write(signature.trim().toLowerCase());
  const same = timingSafeEqual(expected, given) && signature.trim().length === expected.length;
  if (!same) return 'bad';
  const age = Math.abs((input.now ?? Date.now()) / 1000 - Number(timestamp));
  return age <= WINDOW_SECONDS ? 'ok' : 'stale';
}
