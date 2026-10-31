import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { WaResult, WhatsappService } from './service.js';

/** One body for the hub's `whatsapp.send` event and the dashboard's test send. */
export const sendSchema = z
  .object({
    kind: z.enum(['welcome', 'receipt']),
    phone: z.string().trim().min(5).max(30),
    lang: z.enum(['ar', 'en']).default('ar'),
    name: z.string().trim().max(120).optional(),
    amount: z.coerce.number().min(0).max(10_000_000).optional(),
    service: z.string().trim().max(200).optional(),
    invoiceNo: z.union([z.string().trim().min(1).max(40), z.number().int().positive()]).optional(),
    email: z.string().trim().email().max(200).optional(),
    /** The caller's own id for this message (payment id…): a repeated call with the same one sends nothing new. */
    ref: z.string().trim().min(1).max(80).optional(),
  })
  .refine((body) => body.kind !== 'receipt' || (body.amount !== undefined && body.service && body.invoiceNo !== undefined), { message: 'الإيصال يحتاج amount و service و invoiceNo' });

export type SendBody = z.infer<typeof sendSchema>;

export function runSend(service: WhatsappService, body: SendBody): Promise<WaResult> {
  const common = { phone: body.phone, lang: body.lang, email: body.email, ref: body.ref };
  return body.kind === 'welcome'
    ? service.sendWelcome({ ...common, name: body.name })
    : service.sendReceipt({ ...common, amount: body.amount ?? 0, service: body.service ?? '', invoiceNo: body.invoiceNo ?? '' });
}

export type WhatsappWebhookOptions = { service: WhatsappService; verifyToken?: string; appSecret?: string };

const same = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Meta's callback URL (WhatsApp → Configuration): the GET handshake and the POST with delivery states.
 * Always answers 200 so Meta never disables the subscription over our hiccup; with WHATSAPP_APP_SECRET set, a body whose
 * X-Hub-Signature-256 does not match is ignored.
 */
export const whatsappWebhookRoutes: FastifyPluginAsync<WhatsappWebhookOptions> = async (app, { service, verifyToken, appSecret }) => {
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_request, body, done) => done(null, body));

  app.get('/api/whatsapp/webhook', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (verifyToken && query['hub.mode'] === 'subscribe' && typeof query['hub.verify_token'] === 'string' && same(query['hub.verify_token'], verifyToken)) {
      return reply.code(200).type('text/plain').send(query['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: { code: 'forbidden', message: 'verify token mismatch' } });
  });

  app.post('/api/whatsapp/webhook', async (request, reply) => {
    const raw = typeof request.body === 'string' ? request.body : '';
    if (appSecret) {
      const given = String(request.headers['x-hub-signature-256'] ?? '');
      const expected = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
      if (!same(given, expected)) {
        request.log.warn('whatsapp webhook ignored: bad signature');
        return reply.code(200).send({ ok: true, ignored: true });
      }
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    const counts = await service.ingestWebhook(json);
    return reply.code(200).send({ ok: true, ...counts });
  });
};

export type WhatsappAdminOptions = { service: WhatsappService; auth: AuthService };

/** Dashboard side: what Meta says about our templates, the last messages, and the first real test send. */
export const whatsappAdminRoutes: FastifyPluginAsync<WhatsappAdminOptions> = async (app, { service, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/whatsapp',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      let templates: Awaited<ReturnType<WhatsappService['templateOverview']>> = [];
      let templatesError: string | null = null;
      if (service.enabled) {
        try {
          templates = await service.templateOverview();
        } catch (error) {
          templatesError = error instanceof Error ? error.message : 'error';
        }
      }
      return { enabled: service.enabled, templates, templatesError, recent: await service.recent(20) };
    }),
  );

  app.post(
    '/api/admin/whatsapp/test',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(sendSchema, request.body, reply);
      if (!body) return;
      return runSend(service, body);
    }),
  );
};
