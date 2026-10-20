import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { PayLinksService } from './service.js';

export type PayLinksRoutesOptions = { service: PayLinksService; auth: AuthService };

const createSchema = z.object({
  kind: z.enum(['membership', 'workshop', 'other']),
  label: z.string().trim().max(140).default(''),
  amountSar: z.number().int().min(1, 'اكتب المبلغ').max(1_000_000),
  days: z.number().int().min(1).max(3650).default(365),
  /** M108b: a permanent link (/pay/link/:id) mints a fresh invoice per visitor and never expires. */
  permanent: z.boolean().default(false),
  customer: z
    .object({
      name: z.string().trim().max(120).default(''),
      phone: z.string().trim().max(30).default(''),
      email: z.string().trim().max(190).default(''),
    })
    .default({ name: '', phone: '', email: '' }),
});

/** M44 «روابط الدفع»: dashboard-only — the app never sees these routes (rule 3). Admins alone (no moderators). */
export const payLinksRoutes: FastifyPluginAsync<PayLinksRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/paylinks',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { links: await service.list() };
    }),
  );

  app.post(
    '/api/admin/paylinks',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(createSchema, request.body, reply);
      if (!input) return;
      const link = await service.create(input, admin.me.name || admin.me.email);
      return reply.code(201).send({ link });
    }),
  );

  // M108b: the public face of a permanent link — each visit redirects to a fresh invoice.
  // Small per-IP window so a bot cannot mint invoices in bulk.
  const visits = new Map<string, { count: number; windowStart: number }>();
  app.get(
    '/pay/link/:id',
    guard(async (request, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid('رابط غير صالح') }), request.params, reply) ?? {};
      if (!id) return;
      const now = Date.now();
      const seen = visits.get(request.ip);
      if (!seen || now - seen.windowStart > 600_000) visits.set(request.ip, { count: 1, windowStart: now });
      else if ((seen.count += 1) > 10) return reply.code(429).send({ error: { code: 'rate_limited', message: 'حاول بعد قليل' } });
      if (visits.size > 10_000) visits.clear();
      const url = await service.freshCheckout(id);
      if (!url) return reply.code(404).send({ error: { code: 'not_found', message: 'الرابط غير موجود' } });
      return reply.redirect(url, 302);
    }),
  );
};
