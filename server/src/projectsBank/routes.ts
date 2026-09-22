import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { guard, parse, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { ProjectAccessService } from './access.js';
import type { BriefService } from './brief.js';
import { localizeFilters, localizePage, localizeProject } from './lang.js';
import type { ProjectsService } from './service.js';
import { PROJECT_SORTS } from './types.js';

export type ProjectsRoutesOptions = { service: ProjectsService; auth: AuthService; access: ProjectAccessService; brief: BriefService };

const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sector: z.string().trim().max(100).optional(),
  stage: z.string().trim().max(100).optional(),
  sort: z.enum(PROJECT_SORTS).default('latest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: { code: 'bad_request', message } });
}

export const projectsRoutes: FastifyPluginAsync<ProjectsRoutesOptions> = async (app, { service, auth, access, brief }) => {
  const requireSession = sessionGuard(auth);
  const limiter = new RateLimiter();

  // The English app (M27) reads the founders' English fields and the terms' English names (projectsBank/lang.ts).
  app.get('/api/projects', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, 'معاملات البحث غير صالحة');
    return localizePage(service.list(query.data), langOf(request));
  });

  app.get('/api/projects/filters', async (request) => localizeFilters(service.filters(), langOf(request)));

  app.get('/api/projects/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return badRequest(reply, 'رقم المشروع غير صالح');
    const project = service.get(params.data.id);
    if (!project) return reply.code(404).send({ error: { code: 'not_found', message: 'المشروع غير موجود' } });
    return { project: localizeProject(project, langOf(request)) };
  });

  // «ملخص المستشار»: public like the project itself (built from the same public fields), cached per content.
  app.get(
    '/api/projects/:id/brief',
    guard(async (request, reply) => {
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      const project = service.get(params.id);
      if (!project) return reply.code(404).send({ error: { code: 'not_found', message: 'المشروع غير موجود' } });
      if (!limiter.hit(`brief:${request.ip}`, 120, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'طلبات كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      return brief.brief(project, service.all(), Date.now(), langOf(request));
    }),
  );

  // The member's «رصيد» for this project; founder contact data only when PB says he unlocked it (rule 4).
  app.get(
    '/api/projects/:id/access',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      return access.access(current.session, params.id);
    }),
  );

  app.post(
    '/api/projects/:id/unlock',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const params = parse(idParamSchema, request.params, reply);
      if (!params) return;
      return access.unlock(current.session, params.id);
    }),
  );
};
