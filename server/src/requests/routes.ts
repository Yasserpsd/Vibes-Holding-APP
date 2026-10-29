import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { RequestsService } from './service.js';

export type RequestsRoutesOptions = { service: RequestsService; auth: AuthService };

export const statusSchema = z.object({ status: z.enum(['pending', 'in_progress', 'done', 'rejected', 'cancelled']), note: z.string().trim().max(300).default('') });
const idSchema = z.object({ id: z.string().uuid() });

/** M138: the member's timeline and the dashboard's status control for the ledger entries. */
export const requestsRoutes: FastifyPluginAsync<RequestsRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  // Per-user (rule 8): the global hook already answers every /api/* with Cache-Control: no-store.
  app.get(
    '/api/me/requests',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { requests: await service.timeline(current.session.contactId) };
    }),
  );

  app.get(
    '/api/admin/requests',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { requests: await service.list() };
    }),
  );

  app.post(
    '/api/admin/requests/:id/status',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(statusSchema, request.body, reply);
      if (!body) return;
      const entry = await service.setStatus(params.id, body.status, admin.me.name || admin.me.email, body.note);
      return { request: entry };
    }),
  );
};
