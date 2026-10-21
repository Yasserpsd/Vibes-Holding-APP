import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, MEMBER_ONLY_UPSELL, optionalSession, parse, sentOnly, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { PersonLocalizer } from './english.js';
import { myProfile, publicPerson, publicPersonFull, type ProfileFields, type ProfilesService } from './service.js';

export type ProfilesRoutesOptions = { service: ProfilesService; auth: AuthService; english?: PersonLocalizer };

const linkSchema = z.object({
  label: z.string().trim().max(40, 'عنوان الرابط بحد أقصى 40 حرفًا').default(''),
  url: z.string().trim().url('اكتب رابطًا صحيحًا يبدأ بـ https').max(200, 'الرابط بحد أقصى 200 حرف'),
});

const applySchema = z.object({
  title: z.string().trim().min(2, 'اكتب وظيفتك أو منصبك').max(80),
  company: z.string().trim().max(120).default(''),
  // M73: the spotlight sections the owner asked for (2026-10-16).
  specialty: z.string().trim().min(2, 'اكتب مجالك وخبرتك').max(160),
  city: z.string().trim().min(2, 'اكتب مدينتك').max(80),
  bio: z.string().trim().min(30, 'اكتب نبذة أوفى عن شخصيتك ومسيرتك').max(1200),
  milestones: z.array(z.string().trim().min(3).max(140)).min(1, 'أضف محطة واحدة على الأقل من مسيرتك').max(10),
  achievements: z.array(z.string().trim().min(3).max(300)).max(10).default([]),
  benefit: z.array(z.string().trim().min(3).max(200)).max(10).default([]),
  seeking: z.string().trim().max(600).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.string().trim().max(190).default(''),
  links: z.array(linkSchema).max(5).default([]),
});

const longLine = (max: number) => z.string().trim().min(1).max(max, `كل سطر بحد أقصى ${max} حرفًا — قسّم السطر الطويل إلى سطرين`);

const fieldsSchema = applySchema.extend({
  name: z.string().trim().min(2, 'اكتب الاسم').max(80),
  photo: z.string().trim().max(500).nullable().default(null),
  // The member must state them; the admin's manual entry may leave them for later.
  specialty: z.string().trim().max(160).default(''),
  city: z.string().trim().max(80).default(''),
  // M73 fix (owner, 2026-10-17): the admin pastes REAL spotlight content — paragraph-length story
  // lines and rich bios must not bounce off the member-form limits («البيانات غير مكتملة» with no clue).
  bio: z.string().trim().max(4000, 'النبذة بحد أقصى 4000 حرف').default(''),
  milestones: z.array(longLine(600)).max(30, 'بحد أقصى 30 محطة').default([]),
  achievements: z.array(longLine(600)).max(30, 'بحد أقصى 30 إنجازًا').default([]),
  benefit: z.array(longLine(600)).max(30, 'بحد أقصى 30 سطرًا').default([]),
  seeking: z.string().trim().max(1200, 'بحد أقصى 1200 حرف').default(''),
});

const updateSchema = fieldsSchema.partial().extend({ order: z.number().int().min(0).max(9999).optional() });
const createSchema = z.object({ contactId: z.number().int().positive().nullable().default(null), fields: fieldsSchema });
const decisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).default(''),
});
const configSchema = z.object({ intro: z.string().trim().min(10).max(500) });
const idSchema = z.object({ id: z.string().uuid() });

/** M11 «شخصية ومسيرة»: the public people, the member's own application, and the dashboard review. */
export const profilesRoutes: FastifyPluginAsync<ProfilesRoutesOptions> = async (app, { service, auth, english }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);

  app.get(
    '/api/people',
    guard(async (request) => {
      const [config, people] = await Promise.all([service.config(), service.people()]);
      // M118c: the English app reads the spotlight in English — names transliterated, the rest translated.
      const lang = langOf(request);
      if (english && lang === 'en') {
        return { intro: await english.intro(config.intro, lang), people: await english.list(people, lang) };
      }
      return { intro: config.intro, people: people.map(publicPerson) };
    }),
  );

  app.get(
    '/api/people/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      // M109g: the full spotlight (bio, journey, phone, e-mail, links) is a membership feature —
      // guests and non-members browse only the list's public teaser (name, title, photo).
      const who = await whoIs(request);
      if (who?.me?.membership.status !== 'active' && !who?.me?.isAdmin) {
        return reply.code(403).send({ error: { code: 'members_only', message: MEMBER_ONLY_UPSELL } });
      }
      const person = await service.person(params.id);
      if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'الملف غير موجود' } });
      const lang = langOf(request);
      return { person: english ? await english.person(person, lang) : publicPersonFull(person) };
    }),
  );

  app.get(
    '/api/profiles/me',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const [config, mine] = await Promise.all([service.config(), service.mine(current.session.contactId)]);
      return { intro: config.intro, profile: mine ? myProfile(mine) : null };
    }),
  );

  app.post(
    '/api/profiles/apply',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(applySchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const profile = await service.apply(me, input);
      return reply.code(201).send({ profile: myProfile(profile) });
    }),
  );

  app.get(
    '/api/admin/profiles',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const [config, profiles] = await Promise.all([service.config(), service.listAll()]);
      return { config, profiles };
    }),
  );

  app.post(
    '/api/admin/profiles',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(createSchema, request.body, reply);
      if (!input) return;
      const created = await service.create(input.fields as ProfileFields, admin.me.name || admin.me.email, input.contactId);
      return reply.code(201).send({ profile: created });
    }),
  );

  app.put(
    '/api/admin/profiles/config',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(configSchema, request.body, reply);
      if (!input) return;
      return { config: await service.saveConfig(input) };
    }),
  );

  app.put(
    '/api/admin/profiles/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const parsed = parse(updateSchema, request.body, reply);
      if (!parsed) return;
      // Zod 4 fills the defaults even under .partial(): only what the dashboard sent may change.
      const updated = await service.update(params.id, sentOnly(parsed, request.body));
      if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'الملف غير موجود' } });
      return { profile: updated };
    }),
  );

  app.post(
    '/api/admin/profiles/:id/decision',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(decisionSchema, request.body, reply);
      if (!input) return;
      if (input.action === 'reject' && !input.note) {
        return reply.code(400).send({ error: { code: 'invalid', message: 'اكتب للعضو سبب الرفض' } });
      }
      const decided = await service.decide(params.id, input.action, input.note, admin.me.name || admin.me.email);
      if (!decided) return reply.code(404).send({ error: { code: 'not_found', message: 'الملف غير موجود' } });
      return { profile: decided };
    }),
  );

  app.delete(
    '/api/admin/profiles/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const removed = await service.remove(params.id);
      if (!removed) return reply.code(404).send({ error: { code: 'not_found', message: 'الملف غير موجود' } });
      return { ok: true };
    }),
  );
};
