import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { RANGES, type DownloadsService } from './service.js';

export type DownloadsRoutesOptions = { service: DownloadsService; auth: AuthService };

/** M158: the dashboard's downloads card — admin-only, `no-store` like every /api/ answer. */
/** `?days=7|30|90` (the range chips of the home); anything else is 30. */
function rangeOf(query: unknown): number {
  const days = Number((query as { days?: string } | undefined)?.days);
  return (RANGES as readonly number[]).includes(days) ? days : 30;
}

/** M233: the Play Console's daily acquisitions as read on its statistics page, one whole number per day. */
const consoleDays = z.object({ days: z.record(z.string().regex(/^d{4}-d{2}-d{2}$/), z.number().int().min(0).max(1_000_000)) });

export const downloadsRoutes: FastifyPluginAsync<DownloadsRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/downloads',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.read(Date.now(), rangeOf(request.query));
    }),
  );

  // «حدّث الآن»: takes today's snapshot (and asks the stores when configured) instead of waiting for the nightly job.
  app.post(
    '/api/admin/downloads/snapshot',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      await service.snapshot();
      return service.read(Date.now(), rangeOf(request.query));
    }),
  );

  // M233: Google has issued no installs file yet — the days read from the Play Console statistics page stand in, dated.
  app.post(
    '/api/admin/downloads/play-console',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = consoleDays.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_days' });
      const stored = await service.importPlayConsole(body.data.days);
      return { stored, ...(await service.read(Date.now(), rangeOf(request.query))) };
    }),
  );
};
