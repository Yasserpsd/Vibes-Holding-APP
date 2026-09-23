import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { AgendaService } from './service.js';

export type AgendaRoutesOptions = { service: AgendaService; auth: AuthService };

const registerSchema = z.object({ attendance: z.enum(['hq', 'online']) });

const eventSchema = z.object({
  title: z.string().trim().min(3, 'اكتب اسم الفعالية').max(140),
  blurb: z.string().trim().max(1000).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'اكتب اليوم بصيغة 2026-10-05'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'اكتب الوقت بصيغة 19:00').or(z.literal('')).default(''),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'اكتب الوقت بصيغة 21:00').or(z.literal('')).default(''),
  place: z.string().trim().max(200).default(''),
  onlineUrl: z.string().trim().url('اكتب رابطًا صحيحًا').max(300).or(z.literal('')).default(''),
  mode: z.enum(['hq', 'online', 'both']),
  feeSar: z.number().int().min(0).max(100_000).default(0),
  open: z.boolean().default(true),
});

const idSchema = z.object({ id: z.string().uuid() });

/** M41 «أجندة النادي»: the public agenda, the one-tap registration, and the dashboard's event management. */
export const agendaRoutes: FastifyPluginAsync<AgendaRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);

  app.get(
    '/api/agenda',
    guard(async (request) => {
      const who = await whoIs(request);
      return { events: await service.forViewer(who?.me ?? null) };
    }),
  );

  app.get(
    '/api/agenda/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const who = await whoIs(request);
      const event = await service.viewerEvent(params.id, who?.me ?? null);
      if (!event) return reply.code(404).send({ error: { code: 'not_found', message: 'الفعالية غير موجودة' } });
      return { event };
    }),
  );

  app.post(
    '/api/agenda/:id/register',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(registerSchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const result = await service.register(me, params.id, input.attendance);
      return reply.code(201).send({
        registration: { id: result.registration.id, attendance: result.registration.attendance, paid: result.registration.paid },
        payment: result.payment,
      });
    }),
  );

  app.get(
    '/api/admin/agenda',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { events: await service.adminEvents() };
    }),
  );

  app.post(
    '/api/admin/agenda',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(eventSchema, request.body, reply);
      if (!input) return;
      return reply.code(201).send({ event: await service.create(input) });
    }),
  );

  app.put(
    '/api/admin/agenda/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(eventSchema.partial(), request.body, reply);
      if (!input) return;
      const updated = await service.update(params.id, input);
      if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'الفعالية غير موجودة' } });
      return { event: updated };
    }),
  );

  app.delete(
    '/api/admin/agenda/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const removed = await service.remove(params.id);
      if (!removed) return reply.code(404).send({ error: { code: 'not_found', message: 'الفعالية غير موجودة' } });
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/agenda/:id/registrations',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { registrations: await service.registrations(params.id) };
    }),
  );

  app.post(
    '/api/admin/agenda/:id/notify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { ok: true, ...(await service.notify(params.id)) };
    }),
  );
};
