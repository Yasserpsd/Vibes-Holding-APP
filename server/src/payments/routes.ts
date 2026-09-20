import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { getServicesContent } from '../content/services.js';
import type { KV } from '../store.js';
import { mockCheckoutPage, returnPage } from './pages.js';
import type { PaymentsService } from './service.js';

export type PaymentsRoutesOptions = { service: PaymentsService; auth: AuthService; kv: KV; appScheme: string };

const startSchema = z.object({
  serviceKey: z.string().trim().min(1).max(60),
  answers: z.record(z.string().max(40), z.string().trim().max(300)).default({}),
});
const idSchema = z.object({ id: z.string().uuid('رقم العملية غير صالح') });
const statusSchema = z.object({ status: z.enum(['created', 'paid', 'failed']).optional() });

function flatQuery(query: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}

/** Payments need a session; the Paymob callback and the browser pages are public (HMAC-checked). */
export const paymentsRoutes: FastifyPluginAsync<PaymentsRoutesOptions> = async (app, { service, auth, kv, appScheme }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  // The mock gateway page posts a plain HTML form.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.post(
    '/api/payments',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(startSchema, request.body, reply);
      if (!body) return;
      const me = await auth.me(current.session);
      return { payment: await service.start(me, body.serviceKey, body.answers, await getServicesContent(kv)) };
    }),
  );

  app.get(
    '/api/payments',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { payments: await service.list(current.session.contactId) };
    }),
  );

  app.get(
    '/api/payments/:id',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return { payment: await service.get(current.session.contactId, params.id) };
    }),
  );

  // Paymob's transaction-processed callback (per-payment notification URL, CLAUDE.md rule 6).
  app.post(
    '/api/payments/paymob/webhook',
    guard(async (request) => {
      const { hmac } = flatQuery(request.query);
      return service.handleWebhook(request.body, hmac);
    }),
  );

  app.get('/pay/return', async (request, reply) => {
    const result = await service.redirectResult(flatQuery(request.query));
    return reply.type('text/html; charset=utf-8').send(returnPage(result, appScheme));
  });

  app.get(
    '/api/admin/payments',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(statusSchema, request.query, reply);
      if (!query) return;
      return { payments: await service.adminList(query.status ?? null) };
    }),
  );

  if (service.mode === 'mock') {
    app.get(
      '/pay/mock/:id',
      guard(async (request, reply) => {
        const params = parse(idSchema, request.params, reply);
        if (!params) return;
        const payment = await service.peek(params.id);
        if (!payment) return reply.code(404).type('text/html; charset=utf-8').send(returnPage({ payment: null, verified: false, gatewaySuccess: null }, appScheme));
        return reply.type('text/html; charset=utf-8').send(mockCheckoutPage(payment));
      }),
    );

    app.post(
      '/pay/mock/:id/complete',
      guard(async (request, reply) => {
        const params = parse(idSchema, request.params, reply);
        if (!params) return;
        const result = (request.body as { result?: string } | null)?.result === 'success';
        const query = await service.mockComplete(params.id, result);
        return reply.redirect(`/pay/return?${new URLSearchParams(query).toString()}`, 303);
      }),
    );
  }
};
