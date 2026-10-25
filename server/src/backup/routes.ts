import type { FastifyPluginAsync } from 'fastify';

import { adminGuard, guard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { BackupService } from './service.js';

export type BackupRoutesOptions = { service: BackupService; auth: AuthService };

/** M129: the dashboard reads the backup state and can start a run by hand. */
export const backupRoutes: FastifyPluginAsync<BackupRoutesOptions> = async (app, { service, auth }) => {
  const requireAdmin = adminGuard(auth);

  app.get(
    '/api/admin/backup',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.getStatus();
    }),
  );

  app.post(
    '/api/admin/backup/run',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const before = service.getStatus();
      if (!before.enabled) return reply.code(409).send({ error: { code: 'backup_disabled', message: 'النسخ الاحتياطي غير مفعّل على هذا الخادم' } });
      if (before.running) return reply.code(409).send({ error: { code: 'backup_running', message: 'نسخة احتياطية قيد التنفيذ الآن' } });
      // Fire and return: a media mirror can take minutes, the dashboard polls GET for the outcome.
      void service.run();
      return { started: true };
    }),
  );
};
