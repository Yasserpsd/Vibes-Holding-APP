import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { InterestsService } from '../interests/service.js';
import { langOf } from '../lang.js';
import type { ProjectAccessService } from './access.js';
import type { BriefService } from './brief.js';
import { PbImageProxy } from './images.js';
import { localizeFilters, localizePage, localizeProject } from './lang.js';
import type { RatingsService } from '../ratings/service.js';
import type { ProjectsService } from './service.js';
import { PROJECT_SORTS, type ProjectsPage, type PublicProject } from './types.js';

export type ProjectsRoutesOptions = { service: ProjectsService; auth: AuthService; access: ProjectAccessService; brief: BriefService; interests?: InterestsService; ratings?: RatingsService; publicUrl?: string; fetchImpl?: typeof fetch };

const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  sector: z.string().trim().max(100).optional(),
  stage: z.string().trim().max(100).optional(),
  /** M107: `mine=1` keeps only the projects matching the member's saved interests. */
  mine: z.enum(['1', '0']).optional(),
  sort: z.enum(PROJECT_SORTS).default('latest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const galleryParamSchema = z.object({ id: z.coerce.number().int().positive(), index: z.coerce.number().int().min(0).max(30) });

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: { code: 'bad_request', message } });
}

export const projectsRoutes: FastifyPluginAsync<ProjectsRoutesOptions> = async (app, { service, auth, access, brief, interests, ratings, publicUrl, fetchImpl }) => {
  const requireSession = sessionGuard(auth);
  const whoIs = optionalSession(auth);
  const limiter = new RateLimiter();
  const proxy = new PbImageProxy(fetchImpl);

  // M127 (owner, 2026-10-25): browsing felt heavy because each cover was a cold proxy fetch.
  // The covers are warmed right after the feed's first refresh and re-warmed within the TTL.
  const warmCovers = () => void proxy.warm(service.all().flatMap((project) => (project.image ? [project.image] : [])));
  const warmStart = setTimeout(warmCovers, 30_000);
  warmStart.unref();
  const warmTimer = setInterval(warmCovers, 5 * 60 * 60 * 1000);
  warmTimer.unref();
  app.addHook('onClose', async () => {
    clearTimeout(warmStart);
    clearInterval(warmTimer);
  });

  // M107b: the app loads every project photo through the server (images.ts says why).
  // M116: every answered project also carries its stars summary for the cards and the page header.
  const proxied = (project: PublicProject): PublicProject => {
    const withRating = ratings ? { ...project, rating: ratings.summary(project.id) } : project;
    return publicUrl
      ? {
          ...withRating,
          image: project.image ? `${publicUrl}/img/pb/${project.id}` : null,
          gallery: project.gallery.map((_entry, index) => `${publicUrl}/img/pb/${project.id}/g/${index}`),
        }
      : withRating;
  };
  const proxiedPage = (page: ProjectsPage): ProjectsPage => ({ ...page, items: page.items.map(proxied) });

  // M109h: a cold-started server answers image requests BEFORE the feed's first refresh — that is
  // «try again shortly» (503, never cached), not a 404 a CDN could hold onto; a failed upstream
  // fetch of a known image is the same. Only a truly unknown project/slot earns the 404.
  const serveProxied = async (reply: FastifyReply, url: string | null | undefined) => {
    if (!url) return reply.code(service.status().count === 0 ? 503 : 404).header('cache-control', 'no-store').send();
    const image = await proxy.get(url);
    if (!image) return reply.code(503).header('cache-control', 'no-store').send();
    return reply.header('cache-control', 'public, max-age=43200').type(image.type).send(image.buffer);
  };

  app.get('/img/pb/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send();
    return serveProxied(reply, service.get(params.data.id)?.image);
  });

  app.get('/img/pb/:id/g/:index', async (request, reply) => {
    const params = galleryParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send();
    return serveProxied(reply, service.get(params.data.id)?.gallery[params.data.index]);
  });

  // The English app (M27) reads the founders' English fields and the terms' English names (projectsBank/lang.ts).
  app.get('/api/projects', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, 'معاملات البحث غير صالحة');
    const { mine, ...rest } = query.data;
    // M107: «حسب اهتماماتي» filters by the signed-in member's saved interests; without any it changes nothing.
    let forInterests: string[] | undefined;
    if (mine === '1' && interests) {
      const who = await whoIs(request);
      const prefs = who ? await interests.mine(who.session.contactId) : null;
      forInterests = prefs?.keys;
    }
    return proxiedPage(localizePage(service.list({ ...rest, forInterests }), langOf(request)));
  });

  app.get('/api/projects/filters', async (request) => localizeFilters(service.filters(), langOf(request)));

  app.get('/api/projects/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return badRequest(reply, 'رقم المشروع غير صالح');
    const project = service.get(params.data.id);
    if (!project) return reply.code(404).send({ error: { code: 'not_found', message: 'المشروع غير موجود' } });
    return { project: proxied(localizeProject(project, langOf(request))) };
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
      const answer = await brief.brief(project, service.all(), Date.now(), langOf(request));
      // M116c (owner): the comparable projects carry their photo and LIVE stars — added at serve
      // time (new objects, the cached brief untouched) so a fresh rating never waits on the cache.
      return {
        ...answer,
        competitors: answer.competitors.map((competitor) => ({
          ...competitor,
          image: publicUrl && service.get(competitor.id)?.image ? `${publicUrl}/img/pb/${competitor.id}` : null,
          rating: ratings ? ratings.summary(competitor.id) : { stars: null, count: 0 },
        })),
      };
    }),
  );

  // M99c: the investor's wallet card — balance + how many projects he opened (counts only, rule 4 untouched).
  app.get(
    '/api/projects/wallet',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return access.wallet(current.session);
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
