import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { HubError } from '../hub/types.js';
import { AuthError, type AuthService, type Me } from './service.js';
import type { SessionRecord } from './sessions.js';

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** A request the server refuses with an Arabic message (validation, access, state). */
export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Hub, auth and request errors answer with their own status and Arabic message; anything else is unexpected. */
export function guard(handler: Handler): Handler {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof AuthError || error instanceof HubError || error instanceof RequestError) {
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

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** Bearer-token check shared by every signed-in endpoint (account, advisor, services, HQ). */
export function sessionGuard(service: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<SessionAuth | null> => {
    const token = bearerToken(request);
    const session = token ? await service.authenticate(token) : null;
    if (!session) {
      void reply.code(401).send({ error: { code: 'unauthorized', message: 'سجّل الدخول أولًا' } });
      return null;
    }
    return { token, session };
  };
}

export type OptionalAuth = { session: SessionRecord; me: Me | null };

/** Reads the bearer token when present; a missing or stale token means a guest, never a 401. */
export function optionalSession(service: AuthService) {
  return async (request: FastifyRequest): Promise<OptionalAuth | null> => {
    const token = bearerToken(request);
    const session = token ? await service.authenticate(token) : null;
    if (!session) return null;
    let me: Me | null = null;
    try {
      me = await service.me(session);
    } catch {
      me = null;
    }
    return { session, me };
  };
}

export type AdminAuth = SessionAuth & { me: Me };

/** Hub admin accounts only (the dashboard's role until M7). */
export function adminGuard(service: AuthService) {
  const requireSession = sessionGuard(service);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<AdminAuth | null> => {
    const current = await requireSession(request, reply);
    if (!current) return null;
    const me = await service.me(current.session);
    if (!me.isAdmin) {
      void reply.code(403).send({ error: { code: 'forbidden', message: 'هذه الصفحة لإدارة النادي فقط' } });
      return null;
    }
    return { ...current, me };
  };
}
