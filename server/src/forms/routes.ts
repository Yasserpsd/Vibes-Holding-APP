import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { NotifyRecipients } from '../mail/recipients.js';
import { statusSchema } from '../requests/routes.js';
import type { KV } from '../store.js';
import { DiskMediaStore } from '../media/store.js';
import { getFormsContent } from './content.js';
import { FORM_FILE_TYPES, formFileInputSchema, isFormFileKey, type FormFiles } from './files.js';
import { mySubmission, type FormsService } from './service.js';

export type FormsRoutesOptions = { service: FormsService; auth: AuthService; notify: NotifyRecipients; kv: KV; files?: FormFiles | null };

const submitSchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
});

const recipientsSchema = z.object({
  recipients: z.array(z.string().trim().max(120)).max(30),
});

const handledSchema = z.object({ handled: z.boolean() });

/** M16: the in-app registration forms and the dashboard's notification-recipients setting. */
export const formsRoutes: FastifyPluginAsync<FormsRoutesOptions> = async (app, { service, auth, notify, kv, files }) => {
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
      const submission = await service.submit(key, input.answers, me, new Date(), langOf(request));
      return reply.code(201).send({ submission: mySubmission(submission) });
    }),
  );

  // M193: an upload ticket for a form's attachment (the pitch deck). A session is required so the
  // bucket is never an open drop box; the form must really carry a file field.
  app.post(
    '/api/forms/:key/upload',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(formFileInputSchema, request.body, reply);
      if (!input) return;
      const key = String((request.params as { key?: string }).key ?? '');
      const form = (await getFormsContent(kv, 'ar')).forms.find((entry) => entry.key === key);
      if (!form?.fields.some((field) => field.type === 'file')) return reply.code(404).send({ error: { code: 'not_found', message: 'هذا النموذج لا يقبل ملفات' } });
      if (!files) return reply.code(503).send({ error: { code: 'uploads_unavailable', message: 'رفع الملفات غير متاح حاليًا، أرسل الطلب بدون الملف وستطلبه منك الإدارة' } });
      return reply.code(201).send(await files.createUpload(input));
    }),
  );

  // M193: the management's link to an attachment (dashboard + mail). The random key is the permission;
  // the answer is a short-lived presigned redirect, never cached.
  app.get('/forms/files/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    const notFound = { error: { code: 'not_found', message: 'الملف غير موجود' } };
    reply.header('cache-control', 'no-store');
    if (!files || !isFormFileKey(key)) return reply.code(404).send(notFound);
    const location = await files.store.locate(key);
    if (!location) return reply.code(404).send(notFound);
    if ('redirect' in location) return reply.redirect(location.redirect, 302);
    if (!(files.store instanceof DiskMediaStore)) return reply.code(404).send(notFound);
    const extension = key.split('.').pop() ?? '';
    const type = Object.keys(FORM_FILE_TYPES).find((entry) => FORM_FILE_TYPES[entry] === extension) ?? 'application/octet-stream';
    return reply.header('content-type', type).header('content-length', location.size).header('x-content-type-options', 'nosniff').send(files.store.open(location.path));
  });

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

  // M138: the finer status control — the member is mailed and pushed on a real change.
  app.post(
    '/api/admin/forms/:id/status',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(statusSchema, request.body, reply);
      if (!input) return;
      const id = String((request.params as { id?: string }).id ?? '');
      const submission = await service.setStatus(id, input.status, admin.me.name || admin.me.email, input.note);
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
