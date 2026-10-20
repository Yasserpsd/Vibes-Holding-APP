import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sentOnly, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { DiscountsService } from './service.js';

export type DiscountsRoutesOptions = { service: DiscountsService; auth: AuthService };

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const checkSchema = z.object({
  code: z.string().trim().min(1).max(30),
  amount: z.number().int().min(0).max(1_000_000),
});

const codeSchema = z.object({
  code: z.string().trim().min(3).max(30),
  percent: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).max(100_000),
  startsAt: z.string().regex(DAY, 'اكتب اليوم بصيغة 2026-10-20').or(z.literal('')).default(''),
  endsAt: z.string().regex(DAY, 'اكتب اليوم بصيغة 2026-10-20').or(z.literal('')).default(''),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(200).default(''),
});

const codeParamSchema = z.object({ code: z.string().trim().min(1).max(30) });

/** M107 «أكواد الخصم»: the member checks a code before paying; the dashboard creates and tracks them. */
export const discountsRoutes: FastifyPluginAsync<DiscountsRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const limiter = new RateLimiter();

  app.post(
    '/api/discounts/check',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(checkSchema, request.body, reply);
      if (!body) return;
      // Codes are not enumerable: a session may try a handful of codes, not a dictionary.
      if (!limiter.hit(`discount:${current.session.contactId}`, 20, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'محاولات كثيرة، حاول بعد قليل' } });
      }
      return service.apply(body.code, body.amount);
    }),
  );

  app.get(
    '/api/admin/discounts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { codes: await service.adminList() };
    }),
  );

  app.post(
    '/api/admin/discounts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(codeSchema, request.body, reply);
      if (!body) return;
      return reply.code(201).send({ code: await service.create(body) });
    }),
  );

  app.put(
    '/api/admin/discounts/:code',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(codeParamSchema, request.params, reply);
      if (!params) return;
      const parsed = parse(codeSchema.partial(), request.body, reply);
      if (!parsed) return;
      // Zod 4 fills the defaults even under .partial(): only what the dashboard sent may change.
      const patch = sentOnly(parsed, request.body);
      return { code: await service.update(params.code, patch) };
    }),
  );

  app.delete(
    '/api/admin/discounts/:code',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(codeParamSchema, request.params, reply);
      if (!params) return;
      const removed = await service.remove(params.code);
      if (!removed) return reply.code(404).send({ error: { code: 'not_found', message: 'الكود غير موجود' } });
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/discounts/:code/uses',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(codeParamSchema, request.params, reply);
      if (!params) return;
      return { uses: await service.usesOf(params.code) };
    }),
  );
};
