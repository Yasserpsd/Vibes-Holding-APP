import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { KV } from '../store.js';
import type { SyncService } from '../sync/service.js';
import { MAX_WORDING, WordingError, adminStrings, publicStrings, saveWording } from './service.js';

export type AppStringsRoutesOptions = { kv: KV; auth: AuthService; sync: SyncService };

const saveSchema = z.object({
  lang: z.enum(['ar', 'en']),
  key: z.string().trim().min(1).max(120),
  /** `null` = back to the app's own text. */
  value: z.string().max(MAX_WORDING * 2).nullable(),
});

/** The app's wording edits: the app reads them without a session; only a dashboard admin changes them. */
export const appStringsRoutes: FastifyPluginAsync<AppStringsRoutesOptions> = async (app, { kv, auth, sync }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get('/api/strings', async (request) => publicStrings(kv, langOf(request)));

  app.get(
    '/api/admin/strings',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return adminStrings(kv);
    }),
  );

  app.put(
    '/api/admin/strings',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(saveSchema, request.body, reply);
      if (!body) return;
      try {
        const saved = await saveWording(kv, { ...body, by: admin.me.name });
        // Open apps hear it through /api/sync and read the new wording at once.
        await sync.bump('content').catch(() => undefined);
        return { ok: true, ...saved };
      } catch (error) {
        if (error instanceof WordingError) return reply.code(400).send({ error: { code: 'invalid', message: error.message } });
        throw error;
      }
    }),
  );
};
