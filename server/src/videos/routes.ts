import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, parse } from '../auth/guard.js';
import { langOf } from '../lang.js';
import type { VideosService } from './service.js';

export type VideosRoutesOptions = { service: VideosService };

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const idSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'رقم الفيديو غير صالح') });

/** The video library is public: the channel is public and the lines are marketing copy. */
export const videosRoutes: FastifyPluginAsync<VideosRoutesOptions> = async (app, { service }) => {
  app.get(
    '/api/videos',
    guard(async (request, reply) => {
      const query = parse(listSchema, request.query, reply);
      if (!query) return;
      return service.list(query, langOf(request));
    }),
  );

  app.get(
    '/api/videos/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const video = await service.get(params.id, langOf(request));
      if (!video) return reply.code(404).send({ error: { code: 'not_found', message: 'الفيديو غير موجود' } });
      return { video };
    }),
  );
};
