import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { publicCardRequest, type CardService } from './service.js';

export type CardRoutesOptions = { service: CardService; auth: AuthService };

const requestSchema = z.object({
  city: z.string().trim().min(2, 'اكتب المدينة').max(80),
  address: z.string().trim().min(5, 'اكتب العنوان الذي يصل إليه الكارت').max(300),
  phone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(300).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });

/**
 * M30: the membership card's print-and-deliver requests. The card itself needs no endpoint —
 * the app draws it from `/api/me` (`cardNumber`, category, days left).
 */
export const cardRoutes: FastifyPluginAsync<CardRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/card/print',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const mine = await service.mine(current.session.contactId);
      return { request: mine ? publicCardRequest(mine) : null };
    }),
  );

  app.post(
    '/api/card/print',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(requestSchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const created = await service.request(me, input);
      return reply.code(201).send({ request: publicCardRequest(created) });
    }),
  );

  app.get(
    '/api/admin/card-requests',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { requests: await service.list() };
    }),
  );

  app.post(
    '/api/admin/card-requests/:id/done',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const done = await service.markDone(params.id, admin.me.name || admin.me.email);
      if (!done) return reply.code(404).send({ error: { code: 'not_found', message: 'الطلب غير موجود' } });
      return { request: done };
    }),
  );
};
