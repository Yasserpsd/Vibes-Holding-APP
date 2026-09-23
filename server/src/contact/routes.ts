import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { ContactService } from './service.js';

export type ContactRoutesOptions = { service: ContactService; auth: AuthService };

const sendSchema = z.object({ text: z.string().min(1, 'اكتب رسالتك أولًا').max(2000, 'الرسالة أطول من المسموح') });
const memberSchema = z.object({ contactId: z.coerce.number().int().positive() });

/** M36: «راسل الإدارة» — the member's thread, and the dashboard's list, thread and reply. */
export const contactRoutes: FastifyPluginAsync<ContactRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/contact',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const me = await auth.me(current.session);
      return { messages: await service.mine(me) };
    }),
  );

  app.post(
    '/api/contact',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(sendSchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const message = await service.send(me, input.text);
      return reply.code(201).send({ message });
    }),
  );

  app.get(
    '/api/admin/contact',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { threads: await service.adminList() };
    }),
  );

  app.get(
    '/api/admin/contact/:contactId',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(memberSchema, request.params, reply);
      if (!params) return;
      const thread = await service.adminThread(params.contactId);
      if (!thread) return reply.code(404).send({ error: { code: 'not_found', message: 'لا توجد محادثة لهذا العضو' } });
      return { thread };
    }),
  );

  app.post(
    '/api/admin/contact/:contactId/reply',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(memberSchema, request.params, reply);
      if (!params) return;
      const input = parse(sendSchema, request.body, reply);
      if (!input) return;
      const message = await service.reply(params.contactId, admin.me.name || admin.me.email, input.text);
      return reply.code(201).send({ message });
    }),
  );
};
