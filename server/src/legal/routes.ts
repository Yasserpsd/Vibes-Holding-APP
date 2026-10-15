import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard } from '../auth/guard.js';
import type { Notifier } from '../mail/notify.js';
import { accountDeletionPage, privacyPage, termsPage } from './pages.js';

export type LegalRoutesOptions = { notifier: Notifier };

const deletionSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
  // Honeypot: humans never see it; a filled value gets a fake success and no mail.
  website: z.string().max(200).optional().default(''),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * M8 store readiness: public legal pages. The deletion form mails the management
 * (the hub deletion itself stays a verified, owner-side step — never automatic from an
 * unauthenticated web form, so nobody can delete someone else's account by typing an e-mail).
 */
export const legalRoutes: FastifyPluginAsync<LegalRoutesOptions> = async (app, { notifier }) => {
  // The deletion page posts a plain HTML form (parsers are scoped per plugin).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const sendHtml = (reply: { header: (k: string, v: string) => unknown; send: (b: string) => unknown }, html: string) => {
    void reply.header('content-type', 'text/html; charset=utf-8');
    void reply.send(html);
  };

  app.get('/legal/privacy', (_request, reply) => {
    sendHtml(reply, privacyPage());
  });

  app.get('/legal/terms', (_request, reply) => {
    sendHtml(reply, termsPage());
  });

  app.get('/legal/account-deletion', (_request, reply) => {
    sendHtml(reply, accountDeletionPage('form'));
  });

  // In-memory per-IP counter: enough against mindless form spam, resets on deploy by design.
  const hits = new Map<string, number[]>();
  app.post(
    '/legal/account-deletion',
    guard(async (request, reply) => {
      const parsed = deletionSchema.safeParse(request.body);
      if (!parsed.success) return sendHtml(reply.code(400), accountDeletionPage('invalid'));
      const body = parsed.data;
      if (body.website) return sendHtml(reply, accountDeletionPage('sent'));
      const now = Date.now();
      const recent = (hits.get(request.ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT) return sendHtml(reply.code(429), accountDeletionPage('rate_limited'));
      recent.push(now);
      hits.set(request.ip, recent);
      notifier.accountDeletionRequested({ email: body.email, name: body.name, phone: body.phone, note: body.note, ip: request.ip });
      return sendHtml(reply, accountDeletionPage('sent'));
    }),
  );
};
