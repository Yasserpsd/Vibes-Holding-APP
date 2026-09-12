import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { adminGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { HqService } from './service.js';

export type HqRoutesOptions = { service: HqService; auth: AuthService };

const dateSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح') });
const idSchema = z.object({ id: z.string().uuid('رقم الحجز غير صالح') });
const bookSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'الوقت غير صالح'),
  purpose: z.string().trim().min(1, 'اختر الغرض من الزيارة').max(80),
  note: z.string().trim().max(300, 'الملاحظة طويلة، الحد 300 حرف').default(''),
});
const statusSchema = z.object({ status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled']).optional() });
const decisionSchema = z.object({ status: z.enum(['confirmed', 'rejected']), note: z.string().trim().max(300).default('') });
const verifySchema = z.object({ code: z.string().trim().min(6).max(120) });

/** HQ page for everyone; booking, passes and the admin decisions need a session (admins: hub admin accounts). */
export const hqRoutes: FastifyPluginAsync<HqRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = adminGuard(auth);
  const whoIs = optionalSession(auth);

  app.get(
    '/api/hq',
    guard(async (request) => {
      const who = await whoIs(request);
      return service.overview(who?.me ?? null);
    }),
  );

  app.get(
    '/api/hq/slots',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const query = parse(dateSchema, request.query, reply);
      if (!query) return;
      return service.slots(query.date);
    }),
  );

  app.get(
    '/api/hq/visits',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { visits: await service.myVisits(current.session.contactId) };
    }),
  );

  app.post(
    '/api/hq/visits',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(bookSchema, request.body, reply);
      if (!body) return;
      const me = await auth.me(current.session);
      return { visit: await service.book(me, body) };
    }),
  );

  app.post(
    '/api/hq/visits/:id/cancel',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { visit: await service.cancel(current.session.contactId, params.id) };
    }),
  );

  app.get(
    '/api/hq/visits/:id/pass',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { pass: await service.pass(current.session.contactId, params.id) };
    }),
  );

  app.get(
    '/api/admin/hq/visits',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(statusSchema, request.query, reply);
      if (!query) return;
      return { visits: await service.adminList(query.status ?? null) };
    }),
  );

  app.post(
    '/api/admin/hq/visits/:id/decision',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(decisionSchema, request.body, reply);
      if (!body) return;
      return { visit: await service.decide(params.id, body.status, { id: admin.me.id, name: admin.me.name }, body.note) };
    }),
  );

  app.post(
    '/api/admin/hq/verify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(verifySchema, request.body, reply);
      if (!body) return;
      return service.verify(body.code);
    }),
  );
};
