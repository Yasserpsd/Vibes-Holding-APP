import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { HubMode } from '../config.js';
import { MOCK_CODE } from '../hub/mock.js';
import { COUNTRIES, EMAIL_POLICY_TEXT, PHONE_POLICY_TEXT } from '../hub/phone.js';
import { guard, parse, sessionGuard } from './guard.js';
import { RateLimiter } from './rateLimit.js';
import { PERSONAS, type AuthService } from './service.js';

export type AuthRoutesOptions = { service: AuthService; hubMode: HubMode };

const personaSchema = z.enum(['neutral', 'entrepreneur', 'investor']);
const passwordSchema = z.string().min(6, 'كلمة المرور 6 أحرف على الأقل').max(200);
const codeSchema = z.string().trim().regex(/^\d{6}$/, 'الرمز 6 أرقام');
const loginFieldSchema = z.string().trim().min(3).max(190);
const pendingTokenSchema = z.string().min(32).max(128);

const registerSchema = z.object({
  name: z.string().trim().min(2, 'الاسم مطلوب').max(120),
  country: z.string().trim().toLowerCase().max(5).default('sa'),
  phone: z.string().trim().min(7, 'رقم الجوال مطلوب').max(40),
  email: z.string().trim().min(5, 'البريد الإلكتروني مطلوب').max(190),
  password: passwordSchema,
  persona: personaSchema,
  bio: z.string().trim().min(10, 'اكتب نبذة مختصرة عنك (سطر على الأقل)').max(600),
  jobTitle: z.string().trim().max(150).optional(),
  inviteCode: z.string().trim().max(30).optional(),
});
const pendingSchema = z.object({ pendingToken: pendingTokenSchema });
const verifySchema = pendingSchema.extend({ code: codeSchema });
const loginSchema = z.object({ login: loginFieldSchema, password: z.string().min(1, 'كلمة المرور مطلوبة').max(200) });
const otpChallengeSchema = z.object({ challengeToken: pendingTokenSchema });
const otpVerifySchema = otpChallengeSchema.extend({ code: codeSchema });
const resetRequestSchema =z.object({ login: loginFieldSchema });
const resetConfirmSchema = resetRequestSchema.extend({ code: codeSchema, password: passwordSchema });
const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    jobTitle: z.string().trim().max(150),
    company: z.string().trim().max(190),
    city: z.string().trim().max(120),
    website: z.string().trim().max(300),
    bio: z.string().trim().max(600),
    social: z.string().trim().max(800),
    password: passwordSchema,
  })
  .partial();
const deleteSchema = z.object({ password: z.string().min(1, 'كلمة المرور مطلوبة').max(200) });
const meQuerySchema = z.object({ fresh: z.enum(['0', '1']).default('0') });

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { service, hubMode }) => {
  const limiter = new RateLimiter();
  const WINDOW = 15 * 60_000;

  const limited = (name: string, limit: number, request: FastifyRequest, reply: FastifyReply): boolean => {
    if (limiter.hit(`${name}:${request.ip}`, limit, WINDOW)) return false;
    void reply.code(429).send({ error: { code: 'rate', message: 'محاولات كثيرة، حاول بعد قليل' } });
    return true;
  };
  const requireSession = sessionGuard(service);

  app.get('/api/auth/config', async () => ({
    countries: COUNTRIES.map((country) => ({
      code: country.code,
      name: country.name,
      dial: country.dial,
      flag: country.flag,
      example: country.example,
      pattern: country.local.source,
    })),
    personas: PERSONAS,
    phonePolicy: PHONE_POLICY_TEXT,
    emailPolicy: EMAIL_POLICY_TEXT,
    registrationOpen: service.registrationOpen,
    adminOnly: service.adminOnly,
    hubMode,
    testCode: hubMode === 'mock' ? MOCK_CODE : null,
  }));

  app.post(
    '/api/auth/register',
    guard(async (request, reply) => {
      if (limited('register', 6, request, reply)) return;
      const body = parse(registerSchema, request.body, reply);
      if (!body) return;
      return service.register(body, request.ip);
    }),
  );

  app.post(
    '/api/auth/resend',
    guard(async (request, reply) => {
      if (limited('resend', 6, request, reply)) return;
      const body = parse(pendingSchema, request.body, reply);
      if (!body) return;
      return service.resend(body.pendingToken, request.ip);
    }),
  );

  app.post(
    '/api/auth/verify',
    guard(async (request, reply) => {
      if (limited('verify', 12, request, reply)) return;
      const body = parse(verifySchema, request.body, reply);
      if (!body) return;
      return service.verify(body.pendingToken, body.code, request.ip);
    }),
  );

  app.post(
    '/api/auth/login',
    guard(async (request, reply) => {
      if (limited('login', 12, request, reply)) return;
      const body = parse(loginSchema, request.body, reply);
      if (!body) return;
      return service.login(body.login, body.password, request.ip);
    }),
  );

  // Dashboard sign-in (M18): the same hub account, plus a short-lived e-mailed code when ADMIN_OTP is on.
  app.post(
    '/api/admin/auth/login',
    guard(async (request, reply) => {
      if (limited('admin-login', 10, request, reply)) return;
      const body = parse(loginSchema, request.body, reply);
      if (!body) return;
      return service.adminLogin(body.login, body.password, request.ip);
    }),
  );

  app.post(
    '/api/admin/auth/verify',
    guard(async (request, reply) => {
      if (limited('admin-otp', 20, request, reply)) return;
      const body = parse(otpVerifySchema, request.body, reply);
      if (!body) return;
      return service.adminVerify(body.challengeToken, body.code);
    }),
  );

  app.post(
    '/api/admin/auth/resend',
    guard(async (request, reply) => {
      if (limited('admin-resend', 8, request, reply)) return;
      const body = parse(otpChallengeSchema, request.body, reply);
      if (!body) return;
      return service.adminResend(body.challengeToken);
    }),
  );

  app.post(
    '/api/auth/reset/request',
    guard(async (request, reply) => {
      if (limited('reset', 6, request, reply)) return;
      const body = parse(resetRequestSchema, request.body, reply);
      if (!body) return;
      await service.requestReset(body.login, request.ip);
      return { ok: true };
    }),
  );

  app.post(
    '/api/auth/reset/confirm',
    guard(async (request, reply) => {
      if (limited('reset', 6, request, reply)) return;
      const body = parse(resetConfirmSchema, request.body, reply);
      if (!body) return;
      await service.confirmReset(body.login, body.code, body.password, request.ip);
      return { ok: true };
    }),
  );

  app.post(
    '/api/auth/logout',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      await service.logout(auth.token, auth.session);
      return { ok: true };
    }),
  );

  app.get(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const query = meQuerySchema.safeParse(request.query);
      const me = await service.me(auth.session, query.success && query.data.fresh === '1');
      return { me };
    }),
  );

  app.patch(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const body = parse(profileSchema, request.body, reply);
      if (!body) return;
      const me = await service.updateProfile(auth.session, body);
      return { me };
    }),
  );

  app.delete(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const body = parse(deleteSchema, request.body, reply);
      if (!body) return;
      await service.deleteAccount(auth.token, auth.session, body.password);
      return { ok: true };
    }),
  );
};
