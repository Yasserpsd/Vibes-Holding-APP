import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService, Me } from '../auth/service.js';
import { langOf } from '../lang.js';
import { decisionsTitle, type NewsService } from './service.js';
import { NEWS_TOPICS, isTopicKey, topicsFor, type TopicKey } from './types.js';

export type NewsRoutesOptions = { service: NewsService; auth: AuthService };

const listSchema = z.object({
  topic: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const prefsSchema = z.object({ topics: z.array(z.string().trim().max(30)).max(NEWS_TOPICS.length) });
const idSchema = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/, 'رقم الخبر غير صالح') });

/**
 * Public feeds for everyone; interests need a session. A signed-in member gets a personalized ranking.
 * The feeds follow the app's language (`langOf`): English sources for the English version, Arabic otherwise.
 */
export const newsRoutes: FastifyPluginAsync<NewsRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);

  /** Reads the bearer token when present; a missing or stale token means a guest, never a 401. */
  const whoIs = async (request: FastifyRequest): Promise<{ contactId: number; me: Me | null } | null> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await auth.authenticate(token) : null;
    if (!session) return null;
    let me: Me | null = null;
    try {
      me = await auth.me(session);
    } catch {
      me = null;
    }
    return { contactId: session.contactId, me };
  };

  app.get('/api/news/topics', async (request) => {
    const lang = langOf(request);
    return { topics: topicsFor(lang), decisionsTitle: decisionsTitle(lang) };
  });

  app.get(
    '/api/news/feed',
    guard(async (request, reply) => {
      const query = parse(listSchema, request.query, reply);
      if (!query) return;
      const topic: TopicKey | undefined = query.topic ? (isTopicKey(query.topic) ? query.topic : undefined) : undefined;
      if (query.topic && !topic) return reply.code(400).send({ error: { code: 'invalid', message: 'الاهتمام غير معروف' } });
      const who = await whoIs(request);
      const prefs = who ? await service.prefs(who.contactId) : null;
      return service.feed({ topic, page: query.page, limit: query.limit, lang: langOf(request) }, { prefs, persona: who?.me?.persona ?? '' });
    }),
  );

  app.get(
    '/api/news/decisions',
    guard(async (request, reply) => {
      const query = parse(listSchema, request.query, reply);
      if (!query) return;
      return service.decisions({ page: query.page, limit: query.limit, lang: langOf(request) });
    }),
  );

  app.get(
    '/api/news/prefs',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const prefs = await service.prefs(current.session.contactId);
      let persona = '';
      try {
        persona = (await auth.me(current.session)).persona;
      } catch {
        persona = '';
      }
      return { topics: prefs?.topics ?? [], suggested: service.suggestedTopics(persona), saved: prefs !== null };
    }),
  );

  app.put(
    '/api/news/prefs',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(prefsSchema, request.body, reply);
      if (!body) return;
      const topics = [...new Set(body.topics.filter(isTopicKey))];
      const prefs = await service.savePrefs(current.session.contactId, topics);
      return { topics: prefs.topics, saved: true };
    }),
  );

  app.get(
    '/api/news/:id',
    guard(async (request, reply) => {
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const item = service.get(params.id);
      if (!item) return reply.code(404).send({ error: { code: 'not_found', message: 'الخبر غير موجود' } });
      return { item };
    }),
  );
};
