import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { myRegistration, type WorkshopsService } from './service.js';

export type WorkshopsRoutesOptions = { service: WorkshopsService; auth: AuthService };

const registerSchema = z.object({
  workshopId: z.string().trim().min(1).max(60),
  note: z.string().trim().max(300).optional(),
});

/** M10: workshop interest registrations — the schedule itself lives in the guide content block. */
export const workshopsRoutes: FastifyPluginAsync<WorkshopsRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/workshops/mine',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return { registrations: (await service.mine(current.session.contactId)).map(myRegistration) };
    }),
  );

  app.post(
    '/api/workshops/register',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(registerSchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const registration = await service.register(me, input);
      return reply.code(201).send({ registration: myRegistration(registration) });
    }),
  );

  app.get(
    '/api/admin/workshops',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      return { registrations: await service.list() };
    }),
  );
};
