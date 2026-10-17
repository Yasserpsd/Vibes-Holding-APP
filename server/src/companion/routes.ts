import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { contentProblem } from '../content/edits.js';
import { COMPANION_PLACEHOLDERS, type CompanionService, type CompanionTemplates } from './service.js';

export type CompanionRoutesOptions = { service: CompanionService; auth: AuthService };

const poolSchema = z
  .array(z.object({ title: z.string().trim().min(3, 'اكتب عنوان الرسالة').max(80), body: z.string().trim().min(10, 'اكتب نص الرسالة').max(400) }))
  .min(1, 'كل فئة تحتاج رسالة واحدة على الأقل')
  .max(6, 'بحد أقصى 6 رسائل لكل فئة');

const templatesSchema = z.object({ investor: poolSchema, entrepreneur: poolSchema, neutral: poolSchema });
const muteSchema = z.object({ muted: z.boolean() });

/** M87b: the member's mute switch, and the dashboard's template editor for the advisor's daily push. */
export const companionRoutes: FastifyPluginAsync<CompanionRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/companion/me',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      void reply.header('cache-control', 'no-store');
      return { muted: await service.isMuted(current.session.contactId) };
    }),
  );

  app.put(
    '/api/companion/me',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(muteSchema, request.body, reply);
      if (!body) return;
      void reply.header('cache-control', 'no-store');
      return { muted: await service.setMuted(current.session.contactId, body.muted) };
    }),
  );

  app.get(
    '/api/admin/companion',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const [pools, status, preview] = await Promise.all([service.templates(), service.status(), service.drafts()]);
      return { ...pools, ...status, preview, placeholders: COMPANION_PLACEHOLDERS };
    }),
  );

  app.put(
    '/api/admin/companion',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(templatesSchema, request.body, reply);
      if (!body) return;
      // The copy rules of the content editor hold here too («بدون رسوم»، never «مجاني»…).
      for (const pool of Object.values(body)) {
        for (const template of pool) {
          const problem = contentProblem('ar', template.title) ?? contentProblem('ar', template.body);
          if (problem) return reply.code(400).send({ error: { code: 'invalid', message: problem } });
        }
      }
      await service.saveTemplates(body as CompanionTemplates);
      return { ok: true, ...(await service.templates()), preview: await service.drafts() };
    }),
  );

  app.delete(
    '/api/admin/companion',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      await service.resetTemplates();
      return { ok: true, ...(await service.templates()), preview: await service.drafts() };
    }),
  );
};
