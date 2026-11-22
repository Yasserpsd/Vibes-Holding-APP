import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { guard, RequestError, sessionGuard } from '../auth/guard.js';
import { PERSONAS, type AuthService, type Me } from '../auth/service.js';
import type { Config } from '../config.js';
import { langOf } from '../lang.js';
import type { KV } from '../store.js';
import { googleCredentialsOf, googleSaveUrl } from './google.js';
import { appleCredentialsOf, buildPkpass, type PassMember } from './pkpass.js';

export type WalletRoutesOptions = { auth: AuthService; kv: KV; config: Config };

/** What `/api/auth/config` tells the app: a button shows only where the server holds the credentials behind it. */
export function walletFlags(config: Config): { walletApple: boolean; walletGoogle: boolean } {
  return { walletApple: appleCredentialsOf(config) !== null, walletGoogle: googleCredentialsOf(config) !== null };
}

const LINK_MINUTES = 10;
const PKPASS_TYPE = 'application/vnd.apple.pkpass';
const EMBLEM_FILE = 'wallet-emblem.png';

/** The first word of the category (the line before its explainer), in both languages. */
function categoryWords(persona: string): { categoryAr: string; categoryEn: string } {
  const found = PERSONAS.find((entry) => entry.key === persona);
  const first = (text: string) => (text.split('—')[0] ?? '').trim();
  return { categoryAr: found ? first(found.label) : '', categoryEn: found ? first(found.labelEn) : '' };
}

/** The pass says what the in-app card says: the name, the membership number (also the QR value) and the end date. */
function passMemberOf(me: Me): PassMember {
  return { name: me.name, cardNumber: me.cardNumber, endDate: me.membership.endDate, ...categoryWords(me.persona) };
}

type StoredLink = { hash: string; expiresAt: string; pass: string };
const linkKey = (contactId: number) => `wallet:apple:${contactId}`;
const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex');

/**
 * M267 «أضف إلى المحفظة»: the membership card in Apple Wallet and Google Wallet.
 * Apple: `/api/me/wallet/apple` is the signed `.pkpass` itself (Bearer session); `/api/me/wallet/apple/link` gives the app
 * a short-lived address Safari can open without the session header, which serves the same file.
 * Google: `/api/me/wallet/google` gives the «Save to Google Wallet» link.
 * Only an ACTIVE membership gets a pass; without the credentials in the environment the routes answer 404.
 */
export const walletRoutes: FastifyPluginAsync<WalletRoutesOptions> = async (app, { auth, kv, config }) => {
  const requireSession = sessionGuard(auth);
  const apple = appleCredentialsOf(config);
  const google = googleCredentialsOf(config);
  const readEmblem = () => readFileSync(join(process.cwd(), 'assets', EMBLEM_FILE));
  const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store');
  const notFound = (reply: FastifyReply) => noStore(reply).code(404).send({ error: { code: 'not_found', message: 'هذه الخدمة غير متاحة حاليًا' } });

  /** The active member's own account: 401 without a session, 403 without an active membership. */
  const activeMember = async (request: Parameters<typeof requireSession>[0], reply: FastifyReply): Promise<Me | null> => {
    const current = await requireSession(request, reply);
    if (!current) return null;
    const me = await auth.me(current.session);
    if (me.membership.status !== 'active') throw new RequestError('membership_required', 'بطاقة المحفظة متاحة لأعضاء النادي بعد تفعيل العضوية', 403);
    return me;
  };

  app.get(
    '/api/me/wallet/apple',
    guard(async (request, reply) => {
      noStore(reply);
      if (!apple) return notFound(reply);
      const me = await activeMember(request, reply);
      if (!me) return;
      const pass = await buildPkpass(apple, passMemberOf(me), readEmblem);
      return reply.header('Content-Type', PKPASS_TYPE).header('Content-Disposition', 'inline; filename="investors-club.pkpass"').send(pass);
    }),
  );

  app.get(
    '/api/me/wallet/apple/link',
    guard(async (request, reply) => {
      noStore(reply);
      if (!apple) return notFound(reply);
      const me = await activeMember(request, reply);
      if (!me) return;
      const secret = randomBytes(24).toString('base64url');
      const pass = await buildPkpass(apple, passMemberOf(me), readEmblem);
      // One entry per member, replaced by the next request: nothing piles up and an old link dies with the new one.
      const stored: StoredLink = { hash: hashOf(secret), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString(), pass: pass.toString('base64') };
      await kv.set(linkKey(me.id), stored);
      return { url: `${config.PUBLIC_URL}/api/wallet/apple/${me.id}.${secret}.pkpass` };
    }),
  );

  // Opened by Safari with no session header: the address itself is the proof (a random secret, alive ten minutes, one per member).
  app.get(
    '/api/wallet/apple/:file',
    guard(async (request, reply) => {
      noStore(reply);
      if (!apple) return notFound(reply);
      const match = /^(\d{1,12})\.([A-Za-z0-9_-]{20,64})\.pkpass$/.exec((request.params as { file?: string }).file ?? '');
      const stored = match ? await kv.get<StoredLink>(linkKey(Number(match[1]))) : null;
      const given = Buffer.from(hashOf(match?.[2] ?? ''));
      const kept = Buffer.from(stored?.hash ?? '');
      if (!stored || given.length !== kept.length || !timingSafeEqual(given, kept) || Date.parse(stored.expiresAt) < Date.now()) {
        return reply.code(404).send({ error: { code: 'link_expired', message: 'انتهت صلاحية الرابط، افتح بطاقة العضوية في التطبيق وأعد المحاولة' } });
      }
      return reply.header('Content-Type', PKPASS_TYPE).header('Content-Disposition', 'inline; filename="investors-club.pkpass"').send(Buffer.from(stored.pass, 'base64'));
    }),
  );

  app.get(
    '/api/me/wallet/google',
    guard(async (request, reply) => {
      noStore(reply);
      if (!google) return notFound(reply);
      const me = await activeMember(request, reply);
      if (!me) return;
      return { url: googleSaveUrl(google, passMemberOf(me), `${config.PUBLIC_URL}/wallet/emblem.png`, langOf(request) === 'en' ? 'en' : 'ar') };
    }),
  );

  // The club's emblem, public: Google fetches the pass logo from here.
  app.get('/wallet/emblem.png', async (_request, reply) => {
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=86400').send(readEmblem());
  });
};
