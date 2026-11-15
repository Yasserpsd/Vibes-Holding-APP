import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { adminGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { EnglishCache } from '../englishCache.js';
import { langOf, type AppLang } from '../lang.js';
import type { HqService, HqSpace } from './service.js';

export type HqRoutesOptions = { service: HqService; auth: AuthService; /** M242: the management's note on a visit, in English for the English app. */ english?: EnglishCache };

/** M242: the hours-wallet spaces as the English app names them (the booking itself keeps the Arabic label). */
const SPACE_LABELS_EN: Record<HqSpace, string> = { office: 'Private office', meeting: 'Meeting room booking' };

// M109a: the hours-wallet space and duration ride the same date/slots/book routes.
const spaceSchema = z.enum(['office', 'meeting']);
const dateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح'),
  space: spaceSchema.optional(),
  hours: z.coerce.number().int().min(1).max(12).optional(),
});
const idSchema = z.object({ id: z.string().uuid('رقم الحجز غير صالح') });
const bookSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'الوقت غير صالح'),
  // An hours-wallet booking needs no purpose (the space label stands in); a plain visit does.
  purpose: z.string().trim().max(80).default(''),
  note: z.string().trim().max(300, 'الملاحظة طويلة، الحد 300 حرف').default(''),
  space: spaceSchema.optional(),
  hours: z.number().int().min(1, 'اختر مدة الحجز').max(12).optional(),
});
const statusSchema = z.object({ status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled']).optional() });
const decisionSchema = z.object({ status: z.enum(['confirmed', 'rejected']), note: z.string().trim().max(300).default('') });
const verifySchema = z.object({ code: z.string().trim().min(6).max(120) });

/** HQ page for everyone; booking, passes and the admin decisions need a session (admins: hub admin accounts). */
export const hqRoutes: FastifyPluginAsync<HqRoutesOptions> = async (app, { service, auth, english }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = adminGuard(auth);
  const whoIs = optionalSession(auth);

  /**
   * M242: a member's own visits as the English app reads them. The booking stores Arabic (the reception reads it):
   * the purpose is shown by its place in the English list, a wallet space by its English name, and the note the
   * management typed on the decision in English. The member's own note stays as he wrote it. Arabic is untouched.
   */
  const shownIn = async <T extends { purpose: string; adminNote: string | null; space?: HqSpace | null }>(visits: T[], lang: AppLang): Promise<T[]> => {
    if (lang !== 'en' || !visits.length) return visits;
    const [arabic, inEnglish] = await Promise.all([service.content('ar'), service.content('en')]);
    const typed = visits.map((visit) => visit.adminNote ?? '');
    const notes = english ? await english.textsSoon(typed, lang) : typed;
    return visits.map((visit, index) => {
      const at = arabic.purposes.indexOf(visit.purpose);
      const purpose = visit.space ? SPACE_LABELS_EN[visit.space] : at >= 0 && arabic.purposes.length === inEnglish.purposes.length ? (inEnglish.purposes[at] ?? visit.purpose) : visit.purpose;
      return { ...visit, purpose, adminNote: visit.adminNote ? (notes[index] ?? visit.adminNote) : visit.adminNote };
    });
  };
  const oneIn = async <T extends { purpose: string; adminNote: string | null; space?: HqSpace | null }>(visit: T, lang: AppLang): Promise<T> => (await shownIn([visit], lang))[0] ?? visit;

  app.get(
    '/api/hq',
    guard(async (request) => {
      const who = await whoIs(request);
      return service.overview(who?.me ?? null, Date.now(), langOf(request));
    }),
  );

  app.get(
    '/api/hq/slots',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const query = parse(dateSchema, request.query, reply);
      if (!query) return;
      return service.slots(query.date, Date.now(), { space: query.space ?? null, hours: query.hours });
    }),
  );

  // M109a: the member's live annual hours counter.
  app.get(
    '/api/hq/wallet',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const me = await auth.me(current.session);
      return { wallet: await service.wallet(me) };
    }),
  );

  app.get(
    '/api/hq/visits',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { visits: await shownIn(await service.myVisits(current.session.contactId), langOf(request)) };
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
      return { visit: await oneIn(await service.book(me, body, Date.now(), langOf(request)), langOf(request)) };
    }),
  );

  app.post(
    '/api/hq/visits/:id/cancel',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { visit: await oneIn(await service.cancel(current.session.contactId, params.id), langOf(request)) };
    }),
  );

  app.get(
    '/api/hq/visits/:id/pass',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const pass = await service.pass(current.session.contactId, params.id);
      return { pass: { ...pass, visit: await oneIn(pass.visit, langOf(request)) } };
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
