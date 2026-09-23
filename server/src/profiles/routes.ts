import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { myProfile, publicPerson, publicPersonFull, type ProfileFields, type ProfilesService } from './service.js';

export type ProfilesRoutesOptions = { service: ProfilesService; auth: AuthService };

const linkSchema = z.object({
  label: z.string().trim().max(40).default(''),
  url: z.string().trim().url('اكتب رابطًا صحيحًا يبدأ بـ https').max(200),
});

const applySchema = z.object({
  title: z.string().trim().min(2, 'اكتب وظيفتك أو منصبك').max(80),
  company: z.string().trim().max(120).default(''),
  bio: z.string().trim().min(30, 'اكتب نبذة أوفى عن شخصيتك ومسيرتك').max(1200),
  milestones: z.array(z.string().trim().min(3).max(140)).min(1, 'أضف محطة واحدة على الأقل من مسيرتك').max(10),
  links: z.array(linkSchema).max(5).default([]),
});

const fieldsSchema = applySchema.extend({
  name: z.string().trim().min(2).max(80),
  photo: z.string().trim().max(500).nullable().default(null),
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
export const profilesRoutes: FastifyPluginAsync<ProfilesRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/people',
    guard(async () => {
      const [config, people] = await Promise.all([service.config(), service.people()]);
      return { intro: config.intro, people: people.map(publicPerson) };
    }),
  );

  app.get(
    '/api/people/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const person = await service.person(params.id);
      if (!person) return reply.code(404).send({ error: { code: 'not_found', message: 'الملف غير موجود' } });
      return { person: publicPersonFull(person) };
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
      const input = parse(updateSchema, request.body, reply);
      if (!input) return;
      const updated = await service.update(params.id, input);
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
