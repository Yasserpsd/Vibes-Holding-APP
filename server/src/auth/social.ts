import { createPublicKey, verify as verifySignature } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from './guard.js';

/**
 * M46: social sign-in. The app sends the provider's ID token; this class verifies it HERE,
 * against Google's / Apple's published keys (JWKS) — never trusting the client (rule 5's spirit).
 * Client ids are public values; the audiences the server accepts come from the environment.
 */
export type SocialProvider = 'google' | 'apple';

export type SocialIdentity = {
  provider: SocialProvider;
  /** The provider's stable subject id for this account. */
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Google sends the display name inside the token; Apple never does (the app sends it separately). */
  name: string;
};

type Jwk = { kid?: string; kty?: string; alg?: string; n?: string; e?: string };

const PROVIDERS: Record<SocialProvider, { jwks: string; issuers: string[] }> = {
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
};

const JWKS_TTL_MS = 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

const badToken = (): RequestError => new RequestError('social_token', 'تعذّر التحقق من الحساب، حاول من جديد', 401);

function b64uJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Comma-separated audience list from the environment (client ids / bundle ids). */
export function parseAudiences(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 2);
}

export type SocialVerifierOptions = {
  googleAudiences: string[];
  appleAudiences: string[];
  log: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
};

export class SocialVerifier {
  private readonly cache = new Map<SocialProvider, { keys: Jwk[]; at: number }>();

  constructor(private readonly options: SocialVerifierOptions) {}

  enabled(provider: SocialProvider): boolean {
    return this.audiences(provider).length > 0;
  }

  get status(): { google: boolean; apple: boolean } {
    return { google: this.enabled('google'), apple: this.enabled('apple') };
  }

  private audiences(provider: SocialProvider): string[] {
    return provider === 'google' ? this.options.googleAudiences : this.options.appleAudiences;
  }

  async verify(provider: SocialProvider, token: string): Promise<SocialIdentity> {
    const audiences = this.audiences(provider);
    if (audiences.length === 0) {
      throw new RequestError('social_off', 'هذه الطريقة غير مفعّلة حاليًا — سجّل بالبريد وكلمة المرور', 501);
    }
    const [headPart, payloadPart, signaturePart] = token.split('.');
    if (!headPart || !payloadPart || !signaturePart) throw badToken();
    const header = b64uJson(headPart);
    const payload = b64uJson(payloadPart);
    if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string') throw badToken();

    const key = await this.keyFor(provider, header.kid);
    if (!key) throw badToken();
    let valid = false;
    try {
      const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
      valid = verifySignature('RSA-SHA256', Buffer.from(`${headPart}.${payloadPart}`), publicKey, Buffer.from(signaturePart, 'base64url'));
    } catch {
      valid = false;
    }
    if (!valid) throw badToken();

    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    if (!PROVIDERS[provider].issuers.includes(iss)) throw badToken();
    const aud = typeof payload.aud === 'string' ? [payload.aud] : Array.isArray(payload.aud) ? payload.aud.filter((a): a is string => typeof a === 'string') : [];
    if (!aud.some((audience) => audiences.includes(audience))) {
      this.options.log.warn({ provider, aud }, 'social token audience not allowed');
      throw badToken();
    }
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    if (exp * 1000 < Date.now() - CLOCK_SKEW_MS) throw badToken();
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) throw badToken();

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new RequestError('social_email', 'لم يشارك الحساب بريدًا إلكترونيًا — اسمح بمشاركة البريد أو سجّل بالبريد وكلمة المرور', 403);
    }
    // Google sends a boolean; Apple sends true / "true" (relay addresses included). Only an explicit false blocks.
    const verifiedClaim = payload.email_verified;
    const emailVerified = !(verifiedClaim === false || verifiedClaim === 'false');
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : '';
    return { provider, sub, email, emailVerified, name };
  }

  /** JWKS with a one-hour cache; an unknown kid refreshes once (provider key rotation). */
  private async keyFor(provider: SocialProvider, kid: string): Promise<Jwk | null> {
    const cached = this.cache.get(provider);
    if (cached && Date.now() - cached.at < JWKS_TTL_MS) {
      const hit = cached.keys.find((key) => key.kid === kid);
      if (hit) return hit;
    }
    const keys = await this.fetchKeys(provider);
    this.cache.set(provider, { keys, at: Date.now() });
    return keys.find((key) => key.kid === kid) ?? null;
  }

  private async fetchKeys(provider: SocialProvider): Promise<Jwk[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(PROVIDERS[provider].jwks, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      this.options.log.error({ provider, err: error }, 'social keys unreachable');
      throw new RequestError('social_keys', 'تعذّر الاتصال بمزوّد الدخول، حاول بعد قليل', 502);
    }
    if (!response.ok) {
      this.options.log.error({ provider, status: response.status }, 'social keys refused');
      throw new RequestError('social_keys', 'تعذّر الاتصال بمزوّد الدخول، حاول بعد قليل', 502);
    }
    const data = (await response.json().catch(() => null)) as { keys?: Jwk[] } | null;
    if (!data || !Array.isArray(data.keys)) {
      throw new RequestError('social_keys', 'تعذّر الاتصال بمزوّد الدخول، حاول بعد قليل', 502);
    }
    return data.keys.filter((key) => key.kty === 'RSA' && typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string');
  }
}
