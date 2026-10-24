import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { SyncService } from '../sync/service.js';
import type { PartnersService } from './service.js';

export type PartnersRoutesOptions = { service: PartnersService; auth: AuthService; sync: SyncService };

const partnerSchema = z.object({
  name: z.string().trim().min(2, 'اكتب اسم الشريك').max(120),
  nameEn: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  descriptionEn: z.string().trim().max(1000).optional(),
  discount: z.string().trim().max(200).optional(),
  discountEn: z.string().trim().max(200).optional(),
  ribbon: z.string().trim().max(80).optional(),
  ribbonEn: z.string().trim().max(80).optional(),
  url: z.string().trim().url('اكتب رابط الشريك كاملًا (https://…)').max(500),
  whatsapp: z.string().trim().max(30).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  order: z.number().int().min(0).max(9999).optional(),
  visible: z.boolean().optional(),
});

const settingsSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  titleEn: z.string().trim().max(120).optional(),
  intro: z.string().trim().max(1000).optional(),
  introEn: z.string().trim().max(1000).optional(),
  codeTitle: z.string().trim().max(120).optional(),
  codeTitleEn: z.string().trim().max(120).optional(),
  codeHint: z.string().trim().max(500).optional(),
  codeHintEn: z.string().trim().max(500).optional(),
  membersOnlyText: z.string().trim().max(500).optional(),
  membersOnlyTextEn: z.string().trim().max(500).optional(),
});

const idSchema = z.object({ id: z.string().uuid() });
const codeSchema = z.object({ code: z.string().trim().min(3).max(10) });

/**
 * M68 «شركاؤنا»: the public partners page (with the member's personal promo code when his annual
 * membership is active) and the dashboard's full control over the program.
 */
export const partnersRoutes: FastifyPluginAsync<PartnersRoutesOptions> = async (app, { service, auth, sync }) => {
  const whoIs = optionalSession(auth);
  const requireAdmin = dashboardGuard(auth);
  const bump = () => sync.bump('content').catch(() => undefined);

  app.get(
    '/api/partners',
    guard(async (request) => {
      const lang = langOf(request);
      const [settings, partners, who] = await Promise.all([service.settings(), service.visible(lang), whoIs(request)]);
      const me = who?.me ?? null;
      const promo = me && me.membership.status === 'active' ? await service.promoFor(me) : null;
      const en = lang === 'en';
      const pick = (ar: string, english: string) => (en && english ? english : ar);
      return {
        title: pick(settings.title, settings.titleEn),
        intro: pick(settings.intro, settings.introEn),
        codeTitle: pick(settings.codeTitle, settings.codeTitleEn),
        codeHint: pick(settings.codeHint, settings.codeHintEn),
        membersOnlyText: pick(settings.membersOnlyText, settings.membersOnlyTextEn),
        partners,
        isMember: me?.membership.status === 'active',
        promo: promo ? { code: promo.code } : null,
      };
    }),
  );

  app.get(
    '/api/admin/partners',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { settings: await service.settings(), partners: await service.list() };
    }),
  );

  app.post(
    '/api/admin/partners',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(partnerSchema, request.body, reply);
      if (!input) return;
      const partner = await service.create(input);
      await bump();
      return reply.code(201).send({ partner });
    }),
  );

  app.put(
    '/api/admin/partners/settings',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(settingsSchema, request.body, reply);
      if (!input) return;
      const settings = await service.saveSettings(input);
      await bump();
      return { settings };
    }),
  );

  app.put(
    '/api/admin/partners/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(partnerSchema.partial(), request.body, reply);
      if (!input) return;
      const partner = await service.update(params.id, input);
      if (!partner) return reply.code(404).send({ error: { code: 'not_found', message: 'الشريك غير موجود' } });
      await bump();
      return { partner };
    }),
  );

  app.delete(
    '/api/admin/partners/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const removed = await service.remove(params.id);
      if (!removed) return reply.code(404).send({ error: { code: 'not_found', message: 'الشريك غير موجود' } });
      await bump();
      return { ok: true };
    }),
  );

  // «كود مين ده؟» — the owner pastes the code a partner asked about and reads whose it is.
  app.get(
    '/api/admin/partners/promo/:code',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(codeSchema, request.params, reply);
      if (!params) return;
      const promo = await service.lookup(params.code);
      return { promo };
    }),
  );
};
