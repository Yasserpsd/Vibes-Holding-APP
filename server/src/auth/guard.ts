import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { HubError } from '../hub/types.js';
import { deviceOf } from './device.js';
import { AuthError, type AuthService, type Me } from './service.js';
import type { SessionRecord } from './sessions.js';

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** M109f (owner's wording): what every member-only feature answers guests and non-members with. */
export const MEMBER_ONLY_UPSELL = 'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.';

/** A request the server refuses with an Arabic message (validation, access, state). */
export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
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
        const details = error instanceof RequestError ? error.details : undefined;
        // M253: a refusal that knows its field (`details.field`) names it like a refused body does, so the app marks that field.
        const field = typeof details === 'object' && details !== null && typeof (details as { field?: unknown }).field === 'string' ? (details as { field: string }).field : '';
        return reply.code(error.status).send({
          error: { code: error.code, message: error.message, ...(details !== undefined ? { details } : {}), ...(field ? { field, fields: [{ field, path: field, message: error.message }] } : {}) },
        });
      }
      throw error;
    }
  };
}

const ARABIC_TEXT = /[؀-ۿ]/;

/** One refused field of a body: which one, where in it (a line of a list), and the sentence the member reads under it. */
export type FieldProblem = { field: string; path: string; index?: number; message: string };

/**
 * M253 (owner, 2026-11-19: «يظهرلي فورا الخانة اللي فيها مشكلة»): the sentence of one refused field. A rule that
 * carries its own Arabic sentence says it; a rule without one gets a sentence written from the kind of refusal,
 * so no field is ever left with «some details are not valid».
 */
function fieldSentence(issue: { code?: string; message: string; origin?: string; maximum?: unknown; minimum?: unknown }): string {
  if (ARABIC_TEXT.test(issue.message)) return issue.message;
  const max = typeof issue.maximum === 'number' || typeof issue.maximum === 'bigint' ? Number(issue.maximum) : null;
  const min = typeof issue.minimum === 'number' || typeof issue.minimum === 'bigint' ? Number(issue.minimum) : null;
  if (issue.code === 'too_big' && max !== null) {
    if (issue.origin === 'string') return `النص أطول من المسموح، الحد الأقصى للأحرف: ${max}`;
    if (issue.origin === 'array' || issue.origin === 'set') return `العدد أكثر من المسموح، الحد الأقصى: ${max}`;
    return `القيمة أكبر من المسموح، الحد الأقصى: ${max}`;
  }
  if (issue.code === 'too_small' && min !== null) {
    if (issue.origin === 'string') return min <= 1 ? 'هذه الخانة مطلوبة' : `النص أقصر من المطلوب، الحد الأدنى للأحرف: ${min}`;
    if (issue.origin === 'array' || issue.origin === 'set') return 'أضف عنصرًا واحدًا على الأقل في هذه الخانة';
    return `القيمة أقل من المسموح، الحد الأدنى: ${min}`;
  }
  if (issue.code === 'invalid_type' && /received (undefined|null)/.test(issue.message)) return 'هذه الخانة مطلوبة';
  if (issue.code === 'invalid_value') return 'اختر أحد الخيارات المتاحة في هذه الخانة';
  return 'قيمة هذه الخانة غير صحيحة';
}

/** Every refused field of a body, one entry per field (its first refusal), in the order the rules found them. */
export function fieldProblems(issues: readonly { code?: string; message: string; path: readonly PropertyKey[] }[]): FieldProblem[] {
  const seen = new Set<string>();
  const problems: FieldProblem[] = [];
  for (const issue of issues) {
    const field = issue.path.length ? String(issue.path[0]) : '';
    if (!field || seen.has(field)) continue;
    seen.add(field);
    const index = issue.path.find((part): part is number => typeof part === 'number');
    problems.push({ field, path: issue.path.map(String).join('.'), ...(index === undefined ? {} : { index }), message: fieldSentence(issue) });
  }
  return problems;
}

/** M255: the first field a body would be refused for ('' when it passes) — the sign-up counter names it, nothing else. */
export function refusedField(schema: z.ZodType<unknown>, input: unknown): string {
  const result = schema.safeParse(input);
  return result.success ? '' : (fieldProblems(result.error.issues)[0]?.field ?? '');
}

export function parse<T>(schema: z.ZodType<T>, input: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues[0]?.message;
  // M253: `fields` names every refused field with its own sentence; `message` stays what older bundles show.
  const fields = fieldProblems(result.error.issues);
  void reply.code(400).send({
    error: { code: 'invalid', message: message && ARABIC_TEXT.test(message) ? message : 'البيانات غير مكتملة أو غير صحيحة', ...(fields.length ? { field: fields[0]?.field, fields } : {}) },
  });
  return null;
}

/**
 * Zod 4 fills `.default()` fields even under `.partial()`, so a PATCH-style body parsed with a
 * partial schema comes back carrying every defaulted field — and would wipe the stored values.
 * This keeps only the keys the client actually sent.
 */
export function sentOnly<T extends Record<string, unknown>>(parsed: T, body: unknown): Partial<T> {
  const sent = new Set(Object.keys(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}));
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => sent.has(key))) as Partial<T>;
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
    // M264: the request names its address and device; the session keeps the latest (the member's «الجلسات المسجلة»).
    const session = token ? await service.authenticate(token, deviceOf(request)) : null;
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
    const session = token ? await service.authenticate(token, deviceOf(request)) : null;
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

export type AdminAuth = SessionAuth & { me: Me; level: 'admin' | 'moderator' };

/** admin = hub `is_admin`; moderator = hub role `publisher` (M28: shown as «موديريتور», publishing only). */
export function levelOf(me: Me): 'admin' | 'moderator' | null {
  return me.isAdmin ? 'admin' : me.isModerator ? 'moderator' : null;
}

/** Hub admin accounts only: the app's reception screens (`/api/admin/hq/*`), never open to moderators. */
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
    return { ...current, me, level: 'admin' };
  };
}

/**
 * The dashboard's endpoints: a session that started with the e-mailed code while ADMIN_OTP is on (M18).
 * Admins reach everything; a moderator (M28) only the routes built with `allowModerator` — the posts
 * section and its uploads — and gets a 403 naming the admin level everywhere else.
 * The app's reception screens (`/api/admin/hq/*`) keep adminGuard: member sign-in in the app never asks for the code.
 */
export function dashboardGuard(service: AuthService, allowModerator = false) {
  const requireSession = sessionGuard(service);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<AdminAuth | null> => {
    const current = await requireSession(request, reply);
    if (!current) return null;
    const me = await service.me(current.session);
    const level = levelOf(me);
    if (!level || (level === 'moderator' && !allowModerator)) {
      const message = level === 'moderator' ? 'هذا القسم لحسابات الأدمن فقط' : 'هذه الصفحة لإدارة النادي فقط';
      void reply.code(403).send({ error: { code: 'forbidden', message } });
      return null;
    }
    if (service.adminOtpEnabled && !service.adminVerified(current.session)) {
      // A dashboard session whose code lapsed is over for good; an app session (no adminVerifiedAt) is left alone.
      if (current.session.adminVerifiedAt) await service.logout(current.token, current.session);
      void reply.code(403).send({ error: { code: 'otp_required', message: 'ادخل اللوحة من جديد برمز البريد الإلكتروني' } });
      return null;
    }
    // M140: a session from before the authenticator (or an app session of an admin) never opens the dashboard.
    if (service.adminTotpEnabled && !current.session.totpVerifiedAt) {
      void reply.code(403).send({ error: { code: 'totp_required', message: 'ادخل اللوحة من جديد برمز تطبيق المصادقة' } });
      return null;
    }
    return { ...current, me, level };
  };
}
