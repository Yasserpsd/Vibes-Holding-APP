import type { FastifyPluginAsync } from 'fastify';

import { adminGuard, guard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { MembershipService } from './service.js';

export type MembershipRoutesOptions = { service: MembershipService; auth: AuthService; webhookAuth: string | undefined };

/** RevenueCat posts every purchase event here with the configured Authorization header value. */
export const membershipRoutes: FastifyPluginAsync<MembershipRoutesOptions> = async (app, { service, auth, webhookAuth }) => {
  const requireAdmin = adminGuard(auth);

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

  app.get(
    '/api/admin/membership/purchases',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { events: await service.list() };
    }),
  );
};
