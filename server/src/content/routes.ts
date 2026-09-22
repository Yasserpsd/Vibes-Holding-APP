import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';
import type { SyncService } from '../sync/service.js';
import { getAboutContent } from './about.js';
import { ContentError, adminContent, saveContentEdit } from './admin.js';
import { CONTENT_BLOCK_KEYS, MAX_CONTENT_TEXT } from './edits.js';
import { adminValues, saveContentValue } from './values.js';
import { getGoldenContent } from './golden.js';
import { getHomeContent } from './home.js';
import { getMembershipContent } from './membership.js';
import { getServicesContent, publicServices } from './services.js';

export type ContentRoutesOptions = { kv: KV; auth: AuthService; notifier: Notifier; sync: SyncService };

const requestSchema = z.object({
  answers: z.record(z.string().max(40), z.string().trim().max(300)).default({}),
});

const editSchema = z.object({
  block: z.enum(CONTENT_BLOCK_KEYS),
  path: z.string().trim().min(1).max(200),
  lang: z.enum(['ar', 'en']),
  /** `null` = back to the block's own text. */
  value: z.string().max(MAX_CONTENT_TEXT * 2).nullable(),
});

const valueSchema = z.object({
  block: z.enum(CONTENT_BLOCK_KEYS),
  path: z.string().trim().min(1).max(200),
  /** `null` = back to the seed's value (M33 «القيم والأسعار»). */
  value: z.union([z.number(), z.string().max(500), z.boolean()]).nullable(),
});

/**
 * Server-driven content, in the language of the app that asks (`langOf`: `?lang=` or the app's header, Arabic
 * otherwise). Services are the only list shaped per account (locked for non-members). The dashboard edits the
 * wording of every block in both languages through the admin routes.
 */
export const contentRoutes: FastifyPluginAsync<ContentRoutesOptions> = async (app, { kv, auth, notifier, sync }) => {
  const whoIs = optionalSession(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get('/api/golden', async (request) => getGoldenContent(kv, langOf(request)));
  app.get('/api/membership', async (request) => getMembershipContent(kv, langOf(request)));
  app.get('/api/home', async (request) => getHomeContent(kv, langOf(request)));
  app.get('/api/about', async (request) => getAboutContent(kv, langOf(request)));

  app.get(
    '/api/services',
    guard(async (request) => {
      const who = await whoIs(request);
      return publicServices(await getServicesContent(kv, langOf(request)), who?.me ?? null);
    }),
  );

  app.get(
    '/api/services/:key',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const content = await getServicesContent(kv, langOf(request));
      const who = await whoIs(request);
      const list = publicServices(content, who?.me ?? null);
      const service = list.services.find((entry) => entry.key === key);
      if (!service) return reply.code(404).send({ error: { code: 'not_found', message: 'الخدمة غير موجودة' } });
      return { service, lockedText: list.lockedText, isMember: list.isMember };
    }),
  );

  // A WhatsApp handover leaves the app, so the management is told right away, whether or not the
  // member finishes sending the message. Locked services (no action for this account) are refused.
  // The management reads Arabic: the mail names the service and its fields from the Arabic block.
  app.post(
    '/api/services/:key/request',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const body = parse(requestSchema, request.body, reply);
      if (!body) return;
      const lang = langOf(request);
      const content = await getServicesContent(kv, lang);
      const who = await whoIs(request);
      const service = publicServices(content, who?.me ?? null).services.find((entry) => entry.key === key);
      if (!service) return reply.code(404).send({ error: { code: 'not_found', message: 'الخدمة غير موجودة' } });
      if (!service.action || service.action.type !== 'whatsapp') {
        return reply.code(403).send({ error: { code: 'locked', message: 'هذه الخدمة غير متاحة لحسابك' } });
      }
      const arabic = lang === 'ar' ? content : await getServicesContent(kv, 'ar');
      const arabicService = arabic.services.find((entry) => entry.key === key);
      const arabicFields = arabicService?.action.type === 'whatsapp' ? arabicService.action.fields : [];
      const fields = service.action.fields;
      const answers = fields.map((field) => ({ label: arabicFields.find((entry) => entry.key === field.key)?.label ?? field.label, value: body.answers[field.key] ?? '' }));
      const me = who?.me ?? null;
      notifier.serviceRequested({
        serviceTitle: arabicService?.title ?? service.title,
        answers,
        sender: me ? { name: me.name, phone: me.phone, email: me.email } : null,
        channel: service.action.phone,
      });
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/content',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return adminContent(kv);
    }),
  );

  app.put(
    '/api/admin/content',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(editSchema, request.body, reply);
      if (!body) return;
      try {
        const saved = await saveContentEdit(kv, { ...body, by: admin.me.name });
        // Open apps hear it through /api/sync and read the block again at once.
        await sync.bump('content').catch(() => undefined);
        return { ok: true, ...saved };
      } catch (error) {
        if (error instanceof ContentError) return reply.code(400).send({ error: { code: 'invalid', message: error.message } });
        throw error;
      }
    }),
  );

  // M33 «القيم والأسعار»: the prices, links, phone numbers, order numbers and switches of the same blocks.
  app.get(
    '/api/admin/content/values',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return adminValues(kv);
    }),
  );

  app.put(
    '/api/admin/content/value',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(valueSchema, request.body, reply);
      if (!body) return;
      try {
        const saved = await saveContentValue(kv, { ...body, by: admin.me.name });
        await sync.bump('content').catch(() => undefined);
        return { ok: true, ...saved };
      } catch (error) {
        if (error instanceof ContentError) return reply.code(400).send({ error: { code: 'invalid', message: error.message } });
        throw error;
      }
    }),
  );
};
