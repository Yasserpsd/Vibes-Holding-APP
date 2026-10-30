import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import { publicCardRequest, type CardService } from './service.js';

export type CardRoutesOptions = { service: CardService; auth: AuthService };

// M162 (owner): the printed card is picked up at the HQ (no fees) unless the member asks for delivery
// to his address (shipping fees by region). Older apps send no method: they always meant delivery.
const requestSchema = z
  .object({
    method: z.enum(['pickup', 'delivery']).default('delivery'),
    city: z.string().trim().max(80).default(''),
    address: z.string().trim().max(300).default(''),
  phone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(300).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method !== 'delivery') return;
    if (value.city.length < 2) ctx.addIssue({ code: 'custom', path: ['city'], message: 'اكتب المدينة' });
    if (value.address.length < 5) ctx.addIssue({ code: 'custom', path: ['address'], message: 'اكتب العنوان الذي يصل إليه الكارت' });
  });
const idSchema = z.object({ id: z.string().uuid() });
const statusSchema = z.object({ status: z.enum(['pending', 'in_progress', 'done', 'rejected']), note: z.string().trim().max(300).default('') });

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
      const created = await service.request(me, input, new Date(), langOf(request));
      return reply.code(201).send({ request: publicCardRequest(created) });
    }),
  );

  // M163 (owner): the member marks his printed card as received (picked up or delivered); the request closes as done.
  app.post(
    '/api/card/print/:id/received',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const confirmed = await service.confirmReceived(current.session.contactId, params.id);
      if (!confirmed) return reply.code(404).send({ error: { code: 'not_found', message: 'الطلب غير موجود' } });
      return { request: publicCardRequest(confirmed) };
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

  // M138: the dashboard's status control (in progress / delivered / declined) — the member is mailed and pushed.
  app.post(
    '/api/admin/card-requests/:id/status',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(statusSchema, request.body, reply);
      if (!body) return;
      const updated = await service.setStatus(params.id, body.status, admin.me.name || admin.me.email, body.note);
      if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'الطلب غير موجود' } });
      return { request: updated };
    }),
  );
};
