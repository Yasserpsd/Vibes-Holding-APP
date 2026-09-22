import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { DashboardService, SectionError } from '../dashboard/service.js';
import { isScreenName, type AnalyticsService } from './service.js';

export type AnalyticsRoutesOptions = { service: AnalyticsService; auth: AuthService; dashboard: DashboardService };

const screensSchema = z.object({
  device: z.string().trim().regex(/^[A-Za-z0-9-]{8,64}$/),
  screens: z.array(z.string().trim().max(64)).min(1).max(40),
});
const daysSchema = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) });

function sectionError(error: unknown): SectionError {
  return { code: 'unavailable', message: error instanceof Error ? error.message : 'تعذّر تحميل هذا الجزء الآن' };
}

/**
 * M33: the app reports opened screens in batches (aggregates only — the day keeps counts and unique
 * visitors, never who opened what); the dashboard reads the days back with the members-by-category
 * and Projects Bank unlock breakdowns beside them.
 */
export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (app, { service, auth, dashboard }) => {
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);
  const limiter = new RateLimiter();

  app.post(
    '/api/analytics/screens',
    guard(async (request, reply) => {
      if (!limiter.hit(`screens:${request.ip}`, 240, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'طلبات كثيرة في وقت قصير' } });
      }
      const body = parse(screensSchema, request.body, reply);
      if (!body) return;
      const who = await whoIs(request);
      service.screens(body.screens.filter(isScreenName), who ? `c:${who.session.contactId}` : `d:${body.device}`);
      return { ok: true };
    }),
  );

  app.get(
    '/api/admin/analytics',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const query = parse(daysSchema, request.query, reply);
      if (!query) return;
      const errors: { personas?: SectionError; pb?: SectionError } = {};
      const [usage, personas, pbDays] = await Promise.all([
        service.overview(query.days),
        dashboard.personas(admin).catch((error: unknown) => {
          errors.personas = sectionError(error);
          return null;
        }),
        dashboard.pbUnlockDays(query.days).catch((error: unknown) => {
          errors.pb = sectionError(error);
          return null;
        }),
      ]);
      return { days: usage.days, personas, pbDays, errors };
    }),
  );
};
