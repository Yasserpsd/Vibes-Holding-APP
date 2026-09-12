import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, optionalSession, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';
import { getAboutContent } from './about.js';
import { getGoldenContent } from './golden.js';
import { getHomeContent } from './home.js';
import { getMembershipContent } from './membership.js';
import { getServicesContent, publicServices } from './services.js';

export type ContentRoutesOptions = { kv: KV; auth: AuthService; notifier: Notifier };

const requestSchema = z.object({
  answers: z.record(z.string().max(40), z.string().trim().max(300)).default({}),
});

/** Server-driven content. Services are the only list shaped per account (locked for non-members). */
export const contentRoutes: FastifyPluginAsync<ContentRoutesOptions> = async (app, { kv, auth, notifier }) => {
  const whoIs = optionalSession(auth);

  app.get('/api/golden', async () => getGoldenContent(kv));
  app.get('/api/membership', async () => getMembershipContent(kv));
  app.get('/api/home', async () => getHomeContent(kv));
  app.get('/api/about', async () => getAboutContent(kv));

  app.get(
    '/api/services',
    guard(async (request) => {
      const who = await whoIs(request);
      return publicServices(await getServicesContent(kv), who?.me ?? null);
    }),
  );

  app.get(
    '/api/services/:key',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const content = await getServicesContent(kv);
      const who = await whoIs(request);
      const list = publicServices(content, who?.me ?? null);
      const service = list.services.find((entry) => entry.key === key);
      if (!service) return reply.code(404).send({ error: { code: 'not_found', message: 'الخدمة غير موجودة' } });
      return { service, lockedText: list.lockedText, isMember: list.isMember };
    }),
  );

  // A WhatsApp handover leaves the app, so the management is told right away, whether or not the
  // member finishes sending the message. Locked services (no action for this account) are refused.
  app.post(
    '/api/services/:key/request',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const body = parse(requestSchema, request.body, reply);
      if (!body) return;
      const content = await getServicesContent(kv);
      const who = await whoIs(request);
      const service = publicServices(content, who?.me ?? null).services.find((entry) => entry.key === key);
      if (!service) return reply.code(404).send({ error: { code: 'not_found', message: 'الخدمة غير موجودة' } });
      if (!service.action || service.action.type !== 'whatsapp') {
        return reply.code(403).send({ error: { code: 'locked', message: 'هذه الخدمة غير متاحة لحسابك' } });
      }
      const fields = service.action.fields;
      const answers = fields.map((field) => ({ label: field.label, value: body.answers[field.key] ?? '' }));
      const me = who?.me ?? null;
      notifier.serviceRequested({
        serviceTitle: service.title,
        answers,
        sender: me ? { name: me.name, phone: me.phone, email: me.email } : null,
        channel: service.action.phone,
      });
      return { ok: true };
    }),
  );
};
