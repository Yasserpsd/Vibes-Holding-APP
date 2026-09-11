import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { HubError } from '../hub/types.js';
import { AuthError, type AuthService } from './service.js';
import type { SessionRecord } from './sessions.js';

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Hub and auth errors answer with their own status and Arabic message; anything else is unexpected. */
export function guard(handler: Handler): Handler {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof AuthError || error instanceof HubError) {
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  };
}

export function parse<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues[0]?.message;
  void reply.code(400).send({
    error: { code: 'invalid', message: message && /[؀-ۿ]/.test(message) ? message : 'البيانات غير مكتملة أو غير صحيحة' },
  });
  return null;
}

export type SessionAuth = { token: string; session: SessionRecord };

/** Bearer-token check shared by every signed-in endpoint (account, advisor, later services). */
export function sessionGuard(service: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<SessionAuth | null> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await service.authenticate(token) : null;
    if (!session) {
      void reply.code(401).send({ error: { code: 'unauthorized', message: 'سجّل الدخول أولًا' } });
      return null;
    }
    return { token, session };
  };
}
