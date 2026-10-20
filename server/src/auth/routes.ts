import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { HubMode } from '../config.js';
import { langOf } from '../lang.js';
import type { Notifier } from '../mail/notify.js';
import type { MeLocalizer } from './meEnglish.js';
import { MOCK_CODE } from '../hub/mock.js';
import { COUNTRIES, EMAIL_POLICY_TEXT, GENERIC_PATTERN, PHONE_POLICY_TEXT } from '../hub/phone.js';
import { guard, parse, sessionGuard } from './guard.js';
import type { Mailer } from '../mail/mailer.js';
import { PERSONA_CHANGE_DAYS, type PersonaChangeStore } from './personaChange.js';
import { RateLimiter } from './rateLimit.js';
import { PERSONAS, type AuthService } from './service.js';
import type { SocialVerifier } from './social.js';

export type AuthRoutesOptions = {
  service: AuthService;
  hubMode: HubMode;
  social: SocialVerifier;
  notifier?: Notifier;
  /** M101: the e-mailed-code persona change (absent only in old tests; the routes then 404). */
  personaChange?: PersonaChangeStore;
  mailer?: Mailer;
  /** M109e: the member's data in English for the English app (absent in old tests: no `en` block). */
  meLocalizer?: MeLocalizer;
};

const personaSchema = z.enum(['neutral', 'entrepreneur', 'investor']);
const passwordSchema = z.string().min(6, 'كلمة المرور 6 أحرف على الأقل').max(200);
// hub 2.15.5 sends 4-digit codes; 6 stays accepted while pre-upgrade codes are still in flight
const codeSchema = z.string().trim().regex(/^\d{4,6}$/, 'الرمز 4 أرقام');
const loginFieldSchema = z.string().trim().min(3).max(190);
const pendingTokenSchema = z.string().min(32).max(128);

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'الاسم مطلوب').max(120),
    // M69: «فرد» is the default; «شركة» requires the company name (hub plugin 2.18.0 stores both).
    memberType: z.enum(['individual', 'company']).default('individual'),
    companyName: z.string().trim().max(190).optional(),
    country: z.string().trim().toLowerCase().max(5).default('sa'),
    phone: z.string().trim().min(7, 'رقم الجوال مطلوب').max(40),
    email: z.string().trim().min(5, 'البريد الإلكتروني مطلوب').max(190),
    password: passwordSchema,
    persona: personaSchema,
    bio: z.string().trim().min(10, 'اكتب نبذة مختصرة عنك (سطر على الأقل)').max(600),
    jobTitle: z.string().trim().max(150).optional(),
    inviteCode: z.string().trim().max(30).optional(),
  })
  .refine((body) => body.memberType !== 'company' || (body.companyName ?? '').length >= 2, {
    message: 'اكتب اسم الشركة لإكمال التسجيل',
    path: ['companyName'],
  });
const pendingSchema = z.object({ pendingToken: pendingTokenSchema });
const verifySchema = pendingSchema.extend({ code: codeSchema });
const loginSchema = z.object({ login: loginFieldSchema, password: z.string().min(1, 'كلمة المرور مطلوبة').max(200) });
// M46: the provider's ID token (a JWT the server verifies itself); Apple sends the name separately on first sign-in.
const socialSchema = z.object({
  provider: z.enum(['google', 'apple']),
  token: z.string().min(20).max(6000),
  name: z.string().trim().max(120).optional(),
});
const otpChallengeSchema = z.object({ challengeToken: pendingTokenSchema });
const otpVerifySchema = otpChallengeSchema.extend({ code: codeSchema });
const resetRequestSchema =z.object({ login: loginFieldSchema });
const resetConfirmSchema = resetRequestSchema.extend({ code: codeSchema, password: passwordSchema });
const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    // M74: the neutral's «هل حددت وجهتك؟» card switches the category from inside the app.
    persona: personaSchema,
    jobTitle: z.string().trim().max(150),
    company: z.string().trim().max(190),
    city: z.string().trim().max(120),
    website: z.string().trim().max(300),
    bio: z.string().trim().max(600),
    social: z.string().trim().max(800),
    password: passwordSchema,
  })
  .partial();
// M79: the deliberate delete flow sends WHY (a picked reason or the member's own words) so the owner learns from it.
const deleteSchema = z.object({ password: z.string().min(1, 'كلمة المرور مطلوبة').max(200), reason: z.string().trim().max(500).optional() });
const meQuerySchema = z.object({ fresh: z.enum(['0', '1']).default('0') });

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { service, hubMode, social, notifier, personaChange, mailer, meLocalizer }) => {
  const limiter = new RateLimiter();
  const WINDOW = 15 * 60_000;

  // M109e: the English app gets the member's own data in English too; a failed translation
  // never breaks the account answer — the registered data stands in.
  const withEnglish = async (request: FastifyRequest, me: Awaited<ReturnType<AuthService['me']>>) => {
    if (!meLocalizer) return me;
    const en = await meLocalizer.english(me, langOf(request)).catch(() => null);
    return en ? { ...me, en } : me;
  };

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
      nameEn: country.nameEn,
      dial: country.dial,
      flag: country.flag,
      example: country.example,
      pattern: country.local ? country.local.source : GENERIC_PATTERN,
    })),
    personas: PERSONAS,
    phonePolicy: PHONE_POLICY_TEXT,
    emailPolicy: EMAIL_POLICY_TEXT,
    registrationOpen: service.registrationOpen,
    adminOnly: service.adminOnly,
    // M46: which social buttons the app may show (audiences configured on the server).
    social: social.status,
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
      const result = await service.verify(body.pendingToken, body.code, request.ip);
      return { ...result, me: await withEnglish(request, result.me) };
    }),
  );

  app.post(
    '/api/auth/login',
    guard(async (request, reply) => {
      if (limited('login', 12, request, reply)) return;
      const body = parse(loginSchema, request.body, reply);
      if (!body) return;
      const result = await service.login(body.login, body.password, request.ip);
      return result.pending ? result : { ...result, me: await withEnglish(request, result.me) };
    }),
  );

  // M46: sign in (or first-time register) with a Google / Apple account in seconds.
  app.post(
    '/api/auth/social',
    guard(async (request, reply) => {
      if (limited('social', 12, request, reply)) return;
      const body = parse(socialSchema, request.body, reply);
      if (!body) return;
      const identity = await social.verify(body.provider, body.token);
      const result = await service.socialLogin({ ...identity, name: identity.name || body.name?.trim() || '' }, request.ip);
      return { ...result, me: await withEnglish(request, result.me) };
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
      return { me: await withEnglish(request, me) };
    }),
  );

  app.patch(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const body = parse(profileSchema, request.body, reply);
      if (!body) return;
      // M101: members change the persona through the e-mailed-code flow below; the direct patch
      // stays for the club's admins only (they demo the three apps without the 30-day window).
      if (body.persona !== undefined) {
        const current = await service.me(auth.session);
        if (!current.isAdmin && current.persona && current.persona !== body.persona) {
          return reply.code(403).send({ error: { code: 'persona_code_required', message: 'تغيير التوجه يتم بالرمز المُرسل إلى بريدك الإلكتروني' } });
        }
      }
      const me = await service.updateProfile(auth.session, body);
      return { me: await withEnglish(request, me) };
    }),
  );

  // M101 «تغيير التوجه»: the member asks, a code lands in his mailbox, and the confirmed code
  // applies the change at the hub — once every 30 days (admins switch directly, see PATCH above).
  app.post(
    '/api/me/persona/request',
    guard(async (request, reply) => {
      if (!personaChange) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      if (limited('persona', 10, request, reply)) return;
      const body = parse(z.object({ persona: personaSchema }), request.body, reply);
      if (!body) return;
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      if (me.persona === body.persona) {
        return reply.code(400).send({ error: { code: 'persona_same', message: 'هذا هو توجهك الحالي بالفعل' } });
      }
      const label = PERSONAS.find((item) => item.key === body.persona)?.label ?? body.persona;
      const result = await personaChange.request(me.id, body.persona, async (code) => {
        try {
          await mailer?.send({
            to: [me.email],
            subject: 'رمز تغيير التوجه — نادي المستثمرين',
            text: [`رمز تأكيد تغيير توجهك إلى «${label}»: ${code}`, 'الرمز صالح لمدة 10 دقائق ولمرة واحدة فقط.', '', 'يمكنك تغيير توجهك مرة واحدة كل 30 يومًا.', 'إذا لم تطلب هذا التغيير فتجاهل هذه الرسالة.'].join('\n'),
          });
        } catch (error) {
          request.log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'persona change code was not mailed');
          throw new Error('mail_failed');
        }
      }).catch((cause: unknown) => {
        if (cause instanceof Error && cause.message === 'mail_failed') return null;
        throw cause;
      });
      if (!result) return reply.code(503).send({ error: { code: 'mail_failed', message: 'تعذر إرسال الرمز الآن، حاول بعد قليل' } });
      if (!result.ok) {
        if (result.reason === 'cooldown') {
          return reply.code(429).send({ error: { code: 'persona_cooldown', message: `يمكنك تغيير توجهك مرة واحدة كل ${PERSONA_CHANGE_DAYS} يومًا — متبقٍ ${result.daysLeft} يومًا`, daysLeft: result.daysLeft } });
        }
        if (result.reason === 'too_soon') {
          return reply.code(429).send({ error: { code: 'persona_too_soon', message: `انتظر ${result.waitSeconds} ثانية قبل طلب رمز جديد` } });
        }
        return reply.code(429).send({ error: { code: 'persona_too_many', message: 'طلبات كثيرة، حاول لاحقًا' } });
      }
      return { ok: true, email: me.email, seconds: result.seconds, days: PERSONA_CHANGE_DAYS };
    }),
  );

  app.post(
    '/api/me/persona/confirm',
    guard(async (request, reply) => {
      if (!personaChange) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      if (limited('persona-confirm', 20, request, reply)) return;
      const body = parse(z.object({ code: codeSchema }), request.body, reply);
      if (!body) return;
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      const result = await personaChange.confirm(me.id, body.code);
      if (!result.ok) {
        const message =
          result.reason === 'bad_code'
            ? `الرمز غير صحيح — متبقٍ ${result.attemptsLeft} محاولات`
            : result.reason === 'code_expired'
              ? 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا'
              : result.reason === 'locked'
                ? 'محاولات خاطئة كثيرة، اطلب رمزًا جديدًا لاحقًا'
                : 'لا يوجد طلب تغيير قائم، ابدأ من جديد';
        return reply.code(400).send({ error: { code: `persona_${result.reason}`, message } });
      }
      const updated = await service.updateProfile(auth.session, { persona: result.persona });
      if (!updated.isAdmin) await personaChange.stamp(me.id);
      return { me: await withEnglish(request, updated) };
    }),
  );

  app.delete(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const body = parse(deleteSchema, request.body, reply);
      if (!body) return;
      // Who is leaving is read first (the row is emptied by the deletion); the mail goes only after it succeeded.
      const leaving = notifier ? await service.me(auth.session).catch(() => null) : null;
      await service.deleteAccount(auth.token, auth.session, body.password);
      if (notifier && leaving) {
        notifier.accountDeletionRequested({ email: leaving.email, name: leaving.name, phone: leaving.phone, note: body.reason ?? '', ip: request.ip });
      }
      return { ok: true };
    }),
  );
};
