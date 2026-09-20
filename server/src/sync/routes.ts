import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, parse } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { FeedService } from './feed.js';
import type { SyncService } from './service.js';

export type SyncRoutesOptions = { service: SyncService; feed: FeedService };

const feedSchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  // Comma separated knowledge kinds: page, post, project, service, app_post, app_event…
  kinds: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-z0-9_,-]*$/i)
    .default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** «عقل واحد»: the app asks `/api/sync` often and refetches only what moved; `/api/feed` lists what the sites published. */
export const syncRoutes: FastifyPluginAsync<SyncRoutesOptions> = async (app, { service, feed }) => {
  const limiter = new RateLimiter();

  // Served from memory: every open app asks every few seconds.
  app.get('/api/sync', async () => ({ v: await service.versions() }));

  app.get(
    '/api/feed',
    guard(async (request, reply) => {
      // Open to guests: a limit per address, and the answer comes from the service's one snapshot, never from a hub call of the caller's own.
      if (!limiter.hit(`feed:${request.ip}`, 60, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'طلبات كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const query = parse(feedSchema, request.query, reply);
      if (!query) return;
      return feed.changes({ since: query.since, kinds: query.kinds.split(',').filter(Boolean), limit: query.limit });
    }),
  );
};
