import type { FastifyPluginAsync } from 'fastify';

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
};
