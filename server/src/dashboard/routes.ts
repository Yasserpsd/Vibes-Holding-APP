import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { DashboardService } from './service.js';

export type DashboardRoutesOptions = { service: DashboardService; auth: AuthService };

const q = z.string().trim().max(120).default('');
const paging = { page: z.coerce.number().int().min(1).max(100_000).default(1), per_page: z.coerce.number().int().min(1).max(100).default(25) };
const idSchema = z.object({ id: z.coerce.number().int().positive() });
const homeSchema = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) });
const accountsSchema = z.object({ q, state: z.enum(['all', 'pending', 'unpaid', 'member', 'expired', 'admin', 'publisher', 'lead']).default('all'), ...paging });
const paymentsSchema = z.object({ q, status: z.enum(['all', 'ok', 'failed']).default('all'), action: z.string().trim().max(40).default(''), ...paging });
const listSchema = z.object({ q, ...paging });
const leadsSchema = z.object({ q, ltype: z.string().trim().max(40).default(''), ...paging });
const threadsSchema = z.object({ q, filter: z.enum(['all', 'waiting', 'human', 'unread']).default('all'), ...paging });
const threadSchema = z.object({ before: z.coerce.number().int().positive().optional() });
const auditSchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

// Every write names what it does and carries `confirm: true`: a stray request never changes a membership.
const confirm = z.literal(true, 'أكّد العملية أولًا');
const note = z.string().trim().max(300).default('');
const requestId = z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/).nullish();
const grantSchema = z
  .object({ action: z.enum(['activate', 'extend', 'revoke']), days: z.number().int().min(1, 'عدد الأيام غير صحيح').max(3650, 'عدد الأيام غير صحيح').nullish(), note, confirm, requestId })
  .refine((body) => body.action === 'revoke' || typeof body.days === 'number', 'اكتب عدد الأيام');
const roleSchema = z.object({ role: z.enum(['member', 'publisher']), note, confirm, requestId });
const pbGrantSchema = z.object({ amount: z.number().int().min(-50).max(50).refine((value) => value !== 0, 'اكتب عدد المشاريع المضافة أو المخصومة'), note, confirm, requestId });
const replySchema = z.object({ text: z.string().trim().min(1, 'اكتب الرد أولًا').max(4000, 'الرد طويل، الحد 4000 حرف'), confirm, requestId });

/** The dashboard's bridge v2 endpoints: all behind `dashboardGuard`, all `no-store` like every /api/ answer. */
export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/home',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(homeSchema, request.query, reply);
      if (!query) return;
      return service.home(admin, query.days);
    }),
  );

  app.get(
    '/api/admin/accounts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(accountsSchema, request.query, reply);
      if (!query) return;
      return service.accounts(admin, { q: query.q, state: query.state, page: query.page, perPage: query.per_page });
    }),
  );

  app.get(
    '/api/admin/accounts/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return service.account(admin, params.id);
    }),
  );

  app.get(
    '/api/admin/hub-payments',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(paymentsSchema, request.query, reply);
      if (!query) return;
      return service.hubPayments(admin, { q: query.q, status: query.status, action: query.action, page: query.page, perPage: query.per_page });
    }),
  );

  app.get(
    '/api/admin/tickets',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(listSchema, request.query, reply);
      if (!query) return;
      return service.tickets(admin, { q: query.q, page: query.page, perPage: query.per_page });
    }),
  );

  app.get(
    '/api/admin/leads',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(leadsSchema, request.query, reply);
      if (!query) return;
      return service.leads(admin, { q: query.q, ltype: query.ltype, page: query.page, perPage: query.per_page });
    }),
  );

  app.get(
    '/api/admin/threads',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(threadsSchema, request.query, reply);
      if (!query) return;
      return service.threads(admin, { q: query.q, filter: query.filter, page: query.page, perPage: query.per_page });
    }),
  );

  app.get(
    '/api/admin/threads/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const query = parse(threadSchema, request.query, reply);
      if (!query) return;
      return service.thread(admin, params.id, query.before ?? null);
    }),
  );

  app.post(
    '/api/admin/threads/:id/reply',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(replySchema, request.body, reply);
      if (!body) return;
      return service.reply(admin, params.id, body.text, body.requestId ?? null);
    }),
  );

  app.get(
    '/api/admin/mail',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.mail(admin);
    }),
  );

  app.post(
    '/api/admin/accounts/:id/grant',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(grantSchema, request.body, reply);
      if (!body) return;
      return service.grant(admin, params.id, { action: body.action, days: body.action === 'revoke' ? null : (body.days ?? null), note: body.note, requestId: body.requestId ?? null });
    }),
  );

  app.post(
    '/api/admin/accounts/:id/role',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(roleSchema, request.body, reply);
      if (!body) return;
      return service.setRole(admin, params.id, { role: body.role, note: body.note, requestId: body.requestId ?? null });
    }),
  );

  app.post(
    '/api/admin/accounts/:id/pb-grant',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const body = parse(pbGrantSchema, request.body, reply);
      if (!body) return;
      return service.pbGrant(admin, params.id, { amount: body.amount, note: body.note, requestId: body.requestId ?? null });
    }),
  );

  app.get(
    '/api/admin/audit',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(auditSchema, request.query, reply);
      if (!query) return;
      // The stored answers serve the idempotent replays only; the listing says who did what, when and how it went.
      return { entries: (await service.audit(query.limit)).map(({ answer: _answer, ...entry }) => entry) };
    }),
  );
};
