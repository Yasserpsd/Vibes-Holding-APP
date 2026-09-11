import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard, parse, sessionGuard } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';
import type { AdvisorService } from './service.js';

export type AdvisorRoutesOptions = { service: AdvisorService; auth: AuthService };

const contextSchema = z.object({ type: z.literal('project'), id: z.number().int().positive() });
const messageSchema = z.object({
  text: z.string().trim().min(1, 'اكتب رسالتك أولًا').max(4000, 'الرسالة طويلة، الحد 4000 حرف'),
  context: contextSchema.nullish(),
});
const pollSchema = z.object({ after: z.coerce.number().int().nonnegative().default(0) });

/** Chat with the hub advisor. Every route needs a session; the hub adds its own per-account limits. */
export const advisorRoutes: FastifyPluginAsync<AdvisorRoutesOptions> = async (app, { service, auth }) => {
  const requireSession = sessionGuard(auth);
  const limiter = new RateLimiter();

  app.get(
    '/api/advisor/history',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      return service.history(current.session);
    }),
  );

  app.post(
    '/api/advisor/message',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (!limiter.hit(`message:${request.ip}`, 60, 15 * 60_000)) {
        return reply.code(429).send({ error: { code: 'rate', message: 'رسائل كثيرة في وقت قصير، حاول بعد قليل' } });
      }
      const body = parse(messageSchema, request.body, reply);
      if (!body) return;
      return service.send(current.session, body.text, body.context ?? null, request.ip);
    }),
  );

  app.get(
    '/api/advisor/poll',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const query = parse(pollSchema, request.query, reply);
      if (!query) return;
      return service.poll(current.session, query.after);
    }),
  );
};
