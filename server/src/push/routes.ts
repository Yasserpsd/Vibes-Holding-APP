import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { PushService } from './service.js';

export type PushRoutesOptions = { service: PushService; auth: AuthService };

const registerSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});
const unregisterSchema = z.object({ token: z.string().min(10).max(200) });
const testSchema = z.object({
  contactId: z.coerce.number().int().positive().optional(),
  title: z.string().min(1).max(80).default('إشعار تجريبي'),
  body: z.string().min(1).max(300).default('هذا إشعار تجريبي من تطبيق نادي المستثمرين.'),
});

/** Device tokens of signed-in members; the admin endpoints show the registry and send a test message. */
export const pushRoutes: FastifyPluginAsync<PushRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.post(
    '/api/push/tokens',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(registerSchema, request.body, reply);
      if (!input) return;
      const result = await service.register(current.session.contactId, input);
      return { ok: true, ...result };
    }),
  );

  app.delete(
    '/api/push/tokens',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(unregisterSchema, request.body, reply);
      if (!input) return;
      await service.unregister(current.session.contactId, input.token);
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/push/tokens',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return await service.summary();
    }),
  );

  app.post(
    '/api/admin/push/test',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(testSchema, request.body ?? {}, reply);
      if (!input) return;
      const contactId = input.contactId ?? admin.session.contactId;
      const outcome = await service.send(contactId, { title: input.title, body: input.body, data: { type: 'test', screen: '/membership' } });
      return { ok: true, contactId, ...outcome };
    }),
  );
};
