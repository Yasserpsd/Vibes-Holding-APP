import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { Translator } from '../translate.js';
import type { AgendaEvent, AgendaService } from './service.js';

export type AgendaRoutesOptions = { service: AgendaService; auth: AuthService; autoPush?: boolean; translator?: Translator };

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
  /** M43: the dashboard's own English wording; absent or empty = the automatic translation stands. */
  english: z.object({ title: z.string().trim().max(140).default(''), blurb: z.string().trim().max(1000).default(''), place: z.string().trim().max(200).default('') }).nullish(),
});

const idSchema = z.object({ id: z.string().uuid() });

/** M41 «أجندة النادي»: the public agenda, the one-tap registration, and the dashboard's event management. */
export const agendaRoutes: FastifyPluginAsync<AgendaRoutesOptions> = async (app, { service, auth, autoPush = true, translator }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);

  /** M43: his own wording from the editor wins for good; otherwise AI writes the English once and
   * rewrites it only while the Arabic changes and he never edited it. */
  const applyEnglish = async (event: AgendaEvent, manual: { title: string; blurb: string; place: string } | null | undefined, previous: AgendaEvent | null): Promise<void> => {
    const manualSet = manual && (manual.title.trim() !== '' || manual.blurb.trim() !== '' || manual.place.trim() !== '') ? manual : null;
    if (manualSet) {
      if (manualSet.title !== (event.en?.title ?? '') || manualSet.blurb !== (event.en?.blurb ?? '') || manualSet.place !== (event.en?.place ?? '')) {
        await service.setEnglish(event.id, { title: manualSet.title, blurb: manualSet.blurb, place: manualSet.place || null }, false);
      }
      return;
    }
    if (!translator || translator.mode === 'off') return;
    const arabicChanged = !previous || previous.title !== event.title || previous.blurb !== event.blurb || previous.place !== event.place;
    if (event.en != null && (event.enAuto === false || !arabicChanged)) return;
    const out = await translator.translate([event.title, event.blurb, event.place]);
    if (out) await service.setEnglish(event.id, { title: out[0] || event.title, blurb: out[1] || event.blurb, place: event.place ? out[2] || event.place : null }, true);
  };

  app.get(
    '/api/agenda',
    guard(async (request) => {
      const who = await whoIs(request);
      return { events: await service.forViewer(who?.me ?? null, langOf(request)) };
    }),
  );

  app.get(
    '/api/agenda/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const who = await whoIs(request);
      const event = await service.viewerEvent(params.id, who?.me ?? null, langOf(request));
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
      const { english, ...fields } = input;
      const event = await service.create(fields);
      await applyEnglish(event, english, null);
      // M42: a new open event tells every device by itself; the «إشعار» button stays for reminders.
      if (autoPush && event.open) {
        void service.notify(event.id).catch(() => undefined);
      }
      return reply.code(201).send({ event: (await service.event(event.id)) ?? event });
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
      const previous = await service.event(params.id);
      const { english, ...fields } = input;
      const updated = await service.update(params.id, fields);
      if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'الفعالية غير موجودة' } });
      await applyEnglish(updated, english, previous);
      return { event: (await service.event(updated.id)) ?? updated };
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
