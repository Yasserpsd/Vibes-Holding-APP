import type { FastifyPluginAsync } from 'fastify';

import { guard, optionalSession } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { KV } from '../store.js';
import { getAboutContent } from './about.js';
import { getGoldenContent } from './golden.js';
import { getHomeContent } from './home.js';
import { getMembershipContent } from './membership.js';
import { getServicesContent, publicServices } from './services.js';

export type ContentRoutesOptions = { kv: KV; auth: AuthService };

/** Server-driven content. Services are the only list shaped per account (locked for non-members). */
export const contentRoutes: FastifyPluginAsync<ContentRoutesOptions> = async (app, { kv, auth }) => {
  const whoIs = optionalSession(auth);

  app.get('/api/golden', async () => getGoldenContent(kv));
  app.get('/api/membership', async () => getMembershipContent(kv));
  app.get('/api/home', async () => getHomeContent(kv));
  app.get('/api/about', async () => getAboutContent(kv));

  app.get(
    '/api/services',
    guard(async (request) => {
      const who = await whoIs(request);
      return publicServices(await getServicesContent(kv), who?.me ?? null);
    }),
  );

  app.get(
    '/api/services/:key',
    guard(async (request, reply) => {
      const key = String((request.params as { key?: string }).key ?? '');
      const content = await getServicesContent(kv);
      const who = await whoIs(request);
      const list = publicServices(content, who?.me ?? null);
      const service = list.services.find((entry) => entry.key === key);
      if (!service) return reply.code(404).send({ error: { code: 'not_found', message: 'الخدمة غير موجودة' } });
      return { service, lockedText: list.lockedText, isMember: list.isMember };
    }),
  );
};
