import { connect } from 'node:net';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import { langOf } from '../lang.js';
import type { AuthService } from '../auth/service.js';
import { getServicesContent } from '../content/services.js';
import type { KV } from '../store.js';
import { mockCheckoutPage, returnPage } from './pages.js';
import type { PaymentsService } from './service.js';

export type PaymentsRoutesOptions = { service: PaymentsService; auth: AuthService; kv: KV; appScheme: string; smtpHost?: string | null; smtpPort?: number };

const startSchema = z.object({
  serviceKey: z.string().trim().min(1).max(60),
  answers: z.record(z.string().max(40), z.string().trim().max(300)).default({}),
  /** M107: an optional discount code; a 100% code confirms the order with no checkout. */
  discountCode: z.string().trim().max(30).optional(),
});
const idSchema = z.object({ id: z.string().uuid('رقم العملية غير صالح') });
const statusSchema = z.object({ status: z.enum(['created', 'paid', 'failed']).optional() });

/** Plain TCP dial per port — tells a firewall block (timeout) apart from an SMTP-level failure. */
async function dialSmtpPorts(host: string | null, configured: number | null): Promise<Record<string, string>> {
  if (!host) return {};
  const ports = [...new Set([configured ?? 465, 465, 587, 25, 2525])];
  const results = await Promise.all(
    ports.map(
      (port) =>
        new Promise<[string, string]>((resolve) => {
          const socket = connect({ host, port, timeout: 5000 });
          const done = (state: string) => {
            socket.destroy();
            resolve([String(port), state]);
          };
          socket.once('connect', () => done('open'));
          socket.once('timeout', () => done('timeout (blocked?)'));
          socket.once('error', (error) => done(String((error as NodeJS.ErrnoException).code ?? error).slice(0, 60)));
        }),
    ),
  );
  return Object.fromEntries(results);
}

function flatQuery(query: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}

/** Payments need a session; the Paymob callback and the browser pages are public (HMAC-checked). */
export const paymentsRoutes: FastifyPluginAsync<PaymentsRoutesOptions> = async (app, { service, auth, kv, appScheme, smtpHost, smtpPort }) => {
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
      return { payment: await service.start(me, body.serviceKey, body.answers, await getServicesContent(kv), body.discountCode, langOf(request)) };
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

  // Moyasar's paid-invoice callback (per-payment URL). The body is only a hint: the server re-reads
  // the invoice from Moyasar's API before anything settles (CLAUDE.md rule 5).
  app.post(
    '/api/payments/moyasar/callback',
    guard(async (request) => {
      const { payment } = flatQuery(request.query);
      const body = (request.body ?? {}) as { id?: unknown };
      const invoiceId = typeof body.id === 'string' ? body.id : undefined;
      const result = await service.confirmMoyasar({ ...(payment ? { paymentId: payment } : {}), ...(invoiceId ? { invoiceId } : {}) });
      return { ok: true, ...result };
    }),
  );

  app.get('/pay/return', async (request, reply) => {
    const result = await service.redirectResult(flatQuery(request.query));
    return reply.type('text/html; charset=utf-8').send(returnPage(result, appScheme));
  });

  // M110: resend the invoice mails (customer + admin copies) and report each send's exact error.
  app.post(
    '/api/admin/payments/:id/invoice/resend',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      return service.resendInvoice(params.id);
    }),
  );

  // Why do no mails arrive? Sends one probe mail, and dials the SMTP host on every usual port so a
  // provider-level block (Railway closes SMTP ports on some plans) shows itself as closed ports.
  app.post(
    '/api/admin/mail/probe',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const [mail, ports] = await Promise.all([service.mailProbe(), dialSmtpPorts(smtpHost ?? null, smtpPort ?? null)]);
      return { ...mail, host: smtpHost ?? null, configuredPort: smtpPort ?? null, ports };
    }),
  );

  // M110: the customer's printable invoice (paid payments only; the uuid is the access key).
  app.get(
    '/pay/invoice/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const html = await service.invoicePage(params.id);
      if (!html) return reply.code(404).type('text/html; charset=utf-8').send(returnPage({ payment: null, verified: false, gatewaySuccess: null }, appScheme));
      return reply.type('text/html; charset=utf-8').send(html);
    }),
  );

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
