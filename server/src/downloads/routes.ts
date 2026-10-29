import type { FastifyPluginAsync } from 'fastify';

import { dashboardGuard, guard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { DownloadsService } from './service.js';

export type DownloadsRoutesOptions = { service: DownloadsService; auth: AuthService };

/** M158: the dashboard's downloads card — admin-only, `no-store` like every /api/ answer. */
export const downloadsRoutes: FastifyPluginAsync<DownloadsRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/downloads',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.read();
    }),
  );

  // «حدّث الآن»: takes today's snapshot (and asks the stores when configured) instead of waiting for the nightly job.
  app.post(
    '/api/admin/downloads/snapshot',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      await service.snapshot();
      return service.read();
    }),
  );
};
