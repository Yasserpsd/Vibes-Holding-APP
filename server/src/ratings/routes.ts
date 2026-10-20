import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sentOnly, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { ProjectsService } from '../projectsBank/service.js';
import { publicReview, type RatingsService } from './service.js';

export type RatingsRoutesOptions = { service: RatingsService; auth: AuthService; projects: ProjectsService };

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const reviewIdSchema = z.object({ reviewId: z.string().uuid() });

const submitSchema = z.object({
  stars: z.number().int().min(1, 'التقييم من نجمة إلى 5 نجوم').max(5, 'التقييم من نجمة إلى 5 نجوم'),
  comment: z.string().trim().max(500, 'التعليق طويل، الحد 500 حرف').default(''),
});

const manualSchema = z.object({
  name: z.string().trim().min(1, 'اكتب اسم صاحب التقييم').max(80),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).default(''),
  photoUrl: z.string().trim().max(500).default(''),
});

const overrideSchema = z.object({ stars: z.number().min(1).max(5).nullable() });

/** M116 «تقييمات المشاريع»: public stars + comments; the dashboard enters the old meetup feedback. */
export const ratingsRoutes: FastifyPluginAsync<RatingsRoutesOptions> = async (app, { service, auth, projects }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);
  const limiter = new RateLimiter();

  // Public like the project itself: guests read the reviews; only rating needs an account.
  app.get(
    '/api/projects/:id/reviews',
    guard(async (request, reply) => {
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      const who = await whoIs(request);
      return {
        summary: service.summary(params.id),
        reviews: await service.listPublic(params.id, who?.session.contactId ?? null),
      };
    }),
  );

  // Any signed-in account rates — member or not (owner's rule); the profile gate still applies.
  app.post(
    '/api/projects/:id/reviews',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      const body = parse(submitSchema, request.body, reply);
      if (!body) return;
      if (!projects.get(params.id)) return reply.code(404).send({ error: { code: 'not_found', message: 'المشروع غير موجود' } });
      if (!limiter.hit(`rating:${current.session.contactId}`, 10, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'محاولات كثيرة، حاول بعد قليل' } });
      }
      const me = await auth.me(current.session);
      const review = await service.submit(params.id, { contactId: me.id, name: me.name, photoUrl: me.avatarUrl }, body.stars, body.comment);
      return { ok: true, review: publicReview(review, me.id), summary: service.summary(params.id) };
    }),
  );

  app.get(
    '/api/admin/ratings',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const rows = await service.adminOverview();
      const titled = rows.map((row) => {
        const project = projects.get(row.projectId);
        return { ...row, title: project?.title ?? `مشروع ${row.projectId}`, number: project?.number ?? null };
      });
      // The picker: every current project, so the owner attaches old feedback to any of them.
      const catalog = projects.all().map((project) => ({ id: project.id, title: project.title, number: project.number }));
      return { rows: titled, catalog };
    }),
  );

  app.get(
    '/api/admin/ratings/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      return { reviews: await service.adminReviews(params.id), summary: service.summary(params.id) };
    }),
  );

  app.post(
    '/api/admin/ratings/:id/reviews',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      const body = parse(manualSchema, request.body, reply);
      if (!body) return;
      return reply.code(201).send({ review: await service.addManual(params.id, body) });
    }),
  );

  app.put(
    '/api/admin/ratings/reviews/:reviewId',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(reviewIdSchema, request.params, reply);
      if (!params) return;
      const body = parse(manualSchema.partial().extend({ hidden: z.boolean().optional() }), request.body, reply);
      if (!body) return;
      // Zod 4 fills defaults under .partial(): only the sent keys may change.
      return { review: await service.adminUpdate(params.reviewId, sentOnly(body, request.body)) };
    }),
  );

  app.delete(
    '/api/admin/ratings/reviews/:reviewId',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(reviewIdSchema, request.params, reply);
      if (!params) return;
      const removed = await service.adminDelete(params.reviewId);
      if (!removed) return reply.code(404).send({ error: { code: 'not_found', message: 'التقييم غير موجود' } });
      return { ok: true };
    }),
  );

  app.put(
    '/api/admin/ratings/:id/override',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      const body = parse(overrideSchema, request.body, reply);
      if (!body) return;
      await service.setOverride(params.id, body.stars);
      return { ok: true, summary: service.summary(params.id) };
    }),
  );
};
