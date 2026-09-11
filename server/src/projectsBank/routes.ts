import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { ProjectsService } from './service.js';
import { PROJECT_SORTS } from './types.js';

export type ProjectsRoutesOptions = { service: ProjectsService };

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

export const projectsRoutes: FastifyPluginAsync<ProjectsRoutesOptions> = async (app, { service }) => {
  app.get('/api/projects', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, 'معاملات البحث غير صالحة');
    return service.list(query.data);
  });

  app.get('/api/projects/filters', async () => service.filters());

  app.get('/api/projects/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return badRequest(reply, 'رقم المشروع غير صالح');
    const project = service.get(params.data.id);
    if (!project) return reply.code(404).send({ error: { code: 'not_found', message: 'المشروع غير موجود' } });
    return { project };
  });
};
