import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService, Me } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { KV } from '../store.js';
import { decisionsTitle, type NewsService } from './service.js';
import { getNewsSources, setSourceEnabled } from './sources.js';
import { NEWS_TOPICS, isTopicKey, tierLabel, topicsFor, type TopicKey } from './types.js';

export type NewsRoutesOptions = { service: NewsService; auth: AuthService; kv: KV };

const listSchema = z.object({
  topic: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const prefsSchema = z.object({ topics: z.array(z.string().trim().max(30)).max(NEWS_TOPICS.length) });
const idSchema = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/, 'رقم الخبر غير صالح') });
const sourceIdSchema = z.object({ id: z.string().trim().min(1).max(60) });
const toggleSchema = z.object({ enabled: z.boolean() });

/**
 * Public feeds for everyone; interests need a session. A signed-in member gets a personalized ranking.
 * The feeds follow the app's language (`langOf`): English sources for the English version, Arabic otherwise.
 */
export const newsRoutes: FastifyPluginAsync<NewsRoutesOptions> = async (app, { service, auth, kv }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

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

  // M34: the dashboard's source control — the list with each source's last-poll health and a toggle.
  // Rule 7 stays whole: turning a source on only lets its real pages in; nothing here writes an item.
  app.get(
    '/api/admin/news/sources',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const status = service.status();
      const health = new Map(status.sources.map((row) => [row.id, row]));
      const sources = (await getNewsSources(kv)).map((source) => ({
        ...source,
        tierLabel: tierLabel(source.tier, 'ar'),
        status: health.get(source.id) ?? null,
      }));
      return { sources, updatedAt: status.updatedAt, lastError: status.lastError, running: status.running, visibleByLang: status.visibleByLang, classifier: status.classifier };
    }),
  );

  app.post(
    '/api/admin/news/sources/:id',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(sourceIdSchema, request.params, reply);
      if (!params) return;
      const body = parse(toggleSchema, request.body, reply);
      if (!body) return;
      const source = await setSourceEnabled(kv, params.id, body.enabled);
      if (!source) return reply.code(404).send({ error: { code: 'not_found', message: 'هذا المصدر غير موجود' } });
      // A source turned on shows its first items on the next poll; the refresh below brings that forward.
      if (body.enabled) void service.refresh();
      return { ok: true, source };
    }),
  );

  app.post(
    '/api/admin/news/refresh',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      // Not awaited: a full poll fetches pages for minutes. The dashboard polls the list to watch it land.
      void service.refresh();
      return { ok: true, running: true };
    }),
  );
};
