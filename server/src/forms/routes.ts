import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { NotifyRecipients } from '../mail/recipients.js';
import type { KV } from '../store.js';
import { getFormsContent } from './content.js';
import { mySubmission, type FormsService } from './service.js';

export type FormsRoutesOptions = { service: FormsService; auth: AuthService; notify: NotifyRecipients; kv: KV };

const submitSchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
});

const recipientsSchema = z.object({
  recipients: z.array(z.string().trim().max(120)).max(30),
});

const handledSchema = z.object({ handled: z.boolean() });

/** M16: the in-app registration forms and the dashboard's notification-recipients setting. */
export const formsRoutes: FastifyPluginAsync<FormsRoutesOptions> = async (app, { service, auth, notify, kv }) => {
  const whoIs = optionalSession(auth);
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  // The definition the app draws; public like the web form itself (a signed-in-only form still
  // reads publicly: the app shows its sign-in door, the server refuses the submission).
  app.get(
    '/api/forms/:key',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const content = await getFormsContent(kv, langOf(request));
      const form = content.forms.find((entry) => entry.key === key);
      if (!form) return reply.code(404).send({ error: { code: 'not_found', message: 'هذا النموذج غير موجود' } });
      return { form };
    }),
  );

  app.get(
    '/api/forms/mine',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { submissions: (await service.mine(current.session.contactId)).map(mySubmission) };
    }),
  );

  app.post(
    '/api/forms/:key',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const input = parse(submitSchema, request.body, reply);
      if (!input) return;
      const who = await whoIs(request);
      const me = who?.me ?? null;
      const submission = await service.submit(key, input.answers, me);
      return reply.code(201).send({ submission: mySubmission(submission) });
    }),
  );

  // The dashboard: every submission, the form titles for the filter, and the handled toggle.
  app.get(
    '/api/admin/forms',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { submissions: await service.list(), forms: await service.definitions() };
    }),
  );

  app.post(
    '/api/admin/forms/:id/handled',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(handledSchema, request.body, reply);
      if (!input) return;
      const id = String((request.params as { id?: string }).id ?? '');
      const submission = await service.setHandled(id, input.handled, admin.me.name || admin.me.email);
      return { submission };
    }),
  );

  // M16's second half: who receives the notification mails (registrations, payments, visits…).
  app.get(
    '/api/admin/notify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { settings: await notify.get() };
    }),
  );

  app.put(
    '/api/admin/notify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(recipientsSchema, request.body, reply);
      if (!input) return;
      return { settings: await notify.set(input.recipients, admin.me.name || admin.me.email) };
    }),
  );

  app.delete(
    '/api/admin/notify',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { settings: await notify.reset() };
    }),
  );
};
