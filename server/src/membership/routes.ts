import type { FastifyPluginAsync } from 'fastify';

import { dashboardGuard, guard, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { MembershipService } from './service.js';

export type MembershipRoutesOptions = { service: MembershipService; auth: AuthService; webhookAuth: string | undefined };

/** Store settings for the app, RevenueCat's webhook, the post-purchase sync and the admin list. */
export const membershipRoutes: FastifyPluginAsync<MembershipRoutesOptions> = async (app, { service, auth, webhookAuth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  // Public SDK keys and product ids only; the app configures RevenueCat from this answer.
  app.get('/api/membership/store', async () => service.storeConfig());

  app.post(
    '/api/webhooks/revenuecat',
    guard(async (request, reply) => {
      if (!webhookAuth) return reply.code(503).send({ error: { code: 'not_configured', message: 'REVENUECAT_WEBHOOK_AUTH is not set' } });
      const header = String(request.headers.authorization ?? '').trim();
      const accepted = header === webhookAuth || header === `Bearer ${webhookAuth}`;
      if (!accepted) return reply.code(401).send({ error: { code: 'unauthorized', message: 'bad webhook authorization' } });
      const event = await service.handleRevenueCat(request.body);
      return { ok: true, activation: event.activation, reason: event.reason };
    }),
  );

  // After a purchase or restore the app asks the server to re-read the membership (never trusting its own store result).
  app.post(
    '/api/membership/sync',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return await service.sync(current.session);
    }),
  );

  app.get(
    '/api/admin/membership/purchases',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { events: await service.list() };
    }),
  );
};
