import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, optionalSession, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { InterestsService } from './service.js';
import { interestsFor, MAX_INTERESTS } from './types.js';

export type InterestsRoutesOptions = { service: InterestsService; auth: AuthService };

const saveSchema = z.object({
  keys: z.array(z.string().trim().max(20)).min(1).max(MAX_INTERESTS),
  other: z.string().trim().max(120).optional(),
});

/** M107: the unified interests — the list, the member's picks, and the dashboard's monthly «أخرى» review. */
export const interestsRoutes: FastifyPluginAsync<InterestsRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);
  const whoIs = optionalSession(auth);

  app.get(
    '/api/interests',
    guard(async (request) => {
      const who = await whoIs(request);
      const mine = who ? await service.mine(who.session.contactId) : null;
      return {
        interests: interestsFor(langOf(request)),
        max: MAX_INTERESTS,
        mine: mine ? { keys: mine.keys, other: mine.other } : null,
        saved: mine !== null,
        suggested: service.suggested(who?.me?.persona ?? ''),
      };
    }),
  );

  app.put(
    '/api/me/interests',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const body = parse(saveSchema, request.body, reply);
      if (!body) return;
      const prefs = await service.save(current.session.contactId, body.keys, body.other);
      return { keys: prefs.keys, other: prefs.other, saved: true };
    }),
  );

  app.get(
    '/api/admin/interests',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return service.report();
    }),
  );
};
