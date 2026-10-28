import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { HubMode } from '../config.js';
import { langOf, sourceOf } from '../lang.js';
import type { Notifier } from '../mail/notify.js';
import type { MeLocalizer } from './meEnglish.js';
import { MOCK_CODE } from '../hub/mock.js';
import { mobileRule } from '../hub/countries.js';
import { COUNTRIES, EMAIL_POLICY_TEXT, GENERIC_PATTERN, PHONE_POLICY_TEXT } from '../hub/phone.js';
import { dashboardGuard, guard, parse, sessionGuard } from './guard.js';
import type { Mailer } from '../mail/mailer.js';
import type { PushService } from '../push/service.js';
import { DELETION_GRACE_DAYS, type AccountDeletionStore } from './deletion.js';
import { PERSONA_CHANGE_DAYS, type PersonaChangeStore } from './personaChange.js';
import { toAdminPersonaRequest, toMyPersonaRequest, type PersonaRequestsService } from './personaRequests.js';
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
  /** M109d «طلب تغيير الصفة»: the dashboard-reviewed request once the yearly change is used up. */
  personaRequests?: PersonaRequestsService;
  push?: PushService;
  /** M117: the three-step, 30-day account deletion (absent only in old tests; the routes then 404). */
  deletion?: AccountDeletionStore;
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
    // M120 (owner): the registration interests reach the hub's «عضو جديد» admin mail.
    interests: z.array(z.string().trim().max(60)).max(6).optional(),
    interestsOther: z.string().trim().max(120).optional(),
  })
  .refine((body) => body.memberType !== 'company' || (body.companyName ?? '').length >= 2, {
    message: 'اكتب اسم الشركة لإكمال التسجيل',
    path: ['companyName'],
  });
const pendingSchema = z.object({ pendingToken: pendingTokenSchema });
const verifySchema = pendingSchema.extend({ code: codeSchema });
// `country` rides along when the member typed a phone number (world-wide dial codes, M126).
const countrySchema = z.string().trim().toLowerCase().max(5).optional();
const loginSchema = z.object({ login: loginFieldSchema, password: z.string().min(1, 'كلمة المرور مطلوبة').max(200), country: countrySchema });
// M46: the provider's ID token (a JWT the server verifies itself); Apple sends the name separately on first sign-in.
const socialSchema = z.object({
  provider: z.enum(['google', 'apple']),
  token: z.string().min(20).max(6000),
  name: z.string().trim().max(120).optional(),
});
const otpChallengeSchema = z.object({ challengeToken: pendingTokenSchema });
const otpVerifySchema = otpChallengeSchema.extend({ code: codeSchema });
// M140: a 6-digit authenticator code, or a backup code («XXXX-XXXX»).
const totpCodeSchema = z.string().trim().min(6, 'أدخل الرمز').max(12);
const totpStepSchema = z.object({ stepToken: pendingTokenSchema, code: totpCodeSchema });
const totpSetupSchema = z.object({ setupToken: pendingTokenSchema, code: totpCodeSchema });
const totpCodeBodySchema = z.object({ code: totpCodeSchema });
const totpSetupStartSchema = z.object({ code: totpCodeSchema.optional() });
const resetRequestSchema = z.object({ login: loginFieldSchema, country: countrySchema });
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
    // M147: the completion gate.
    phone: z.string().trim().min(5).max(40),
    country: z.string().trim().toLowerCase().max(5),
    interests: z.array(z.string().trim().min(1).max(40)).max(10),
    interestsOther: z.string().trim().max(120),
  })
  .partial();
// M79: the deliberate delete flow sends WHY (a picked reason or the member's own words) so the owner learns from it.
const deleteSchema = z.object({ password: z.string().min(1, 'كلمة المرور مطلوبة').max(200), reason: z.string().trim().max(500).optional() });
const meQuerySchema = z.object({ fresh: z.enum(['0', '1']).default('0') });

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { service, hubMode, social, notifier, personaChange, mailer, meLocalizer, personaRequests, push, deletion }) => {
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
      // Owner (2026-10-26): length + leading digits ride along so the app can say
      // «تأكد من رقم الجوال» the moment the number is too long or starts wrong.
      min: mobileRule(country.code)?.min ?? 5,
      max: mobileRule(country.code)?.max ?? 12,
      starts: mobileRule(country.code)?.starts ?? [],
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
      return service.register(body, request.ip, langOf(request), sourceOf(request));
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
      return 'totp' in result || result.pending ? result : { ...result, me: await withEnglish(request, result.me) };
    }),
  );

  app.post(
    '/api/auth/login',
    guard(async (request, reply) => {
      if (limited('login', 12, request, reply)) return;
      const body = parse(loginSchema, request.body, reply);
      if (!body) return;
      const result = await service.login(body.login, body.password, request.ip, body.country);
      return result.pending || 'totp' in result ? result : { ...result, me: await withEnglish(request, result.me) };
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
      const result = await service.socialLogin({ ...identity, name: identity.name || body.name?.trim() || '' }, request.ip, langOf(request), sourceOf(request));
      return 'totp' in result || result.pending ? result : { ...result, me: await withEnglish(request, result.me) };
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

  // M140: the authenticator code completes a member sign-in whose account has one.
  app.post(
    '/api/auth/totp',
    guard(async (request, reply) => {
      if (limited('totp', 20, request, reply)) return;
      const body = parse(totpStepSchema, request.body, reply);
      if (!body) return;
      const result = await service.totpLogin(body.stepToken, body.code);
      return { ...result, me: await withEnglish(request, result.me) };
    }),
  );

  // M140: dashboard — the authenticator code of an enrolled account, or the first code of a fresh enrolment.
  app.post(
    '/api/admin/auth/totp/verify',
    guard(async (request, reply) => {
      if (limited('admin-totp', 20, request, reply)) return;
      const body = parse(totpStepSchema, request.body, reply);
      if (!body) return;
      return service.adminTotpVerify(body.stepToken, body.code);
    }),
  );

  app.post(
    '/api/admin/auth/totp/enroll',
    guard(async (request, reply) => {
      if (limited('admin-totp', 20, request, reply)) return;
      const body = parse(totpSetupSchema, request.body, reply);
      if (!body) return;
      return service.adminTotpEnroll(body.setupToken, body.code);
    }),
  );

  // M140: «حماية إضافية» in the account — status, enrol / re-link, backup codes, off (never off for dashboard accounts while ADMIN_TOTP=1).
  app.get(
    '/api/me/totp',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      void reply.header('cache-control', 'no-store');
      return service.totpStatus(current.session.contactId);
    }),
  );

  app.post(
    '/api/me/totp/setup',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (limited('totp-account', 20, request, reply)) return;
      const body = parse(totpSetupStartSchema, request.body ?? {}, reply);
      if (!body) return;
      void reply.header('cache-control', 'no-store');
      return service.totpSetup(current.session, body.code);
    }),
  );

  app.post(
    '/api/me/totp/confirm',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (limited('totp-account', 20, request, reply)) return;
      const body = parse(totpSetupSchema, request.body, reply);
      if (!body) return;
      void reply.header('cache-control', 'no-store');
      return service.totpConfirm(current.session, body.setupToken, body.code);
    }),
  );

  app.post(
    '/api/me/totp/backup',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (limited('totp-account', 20, request, reply)) return;
      const body = parse(totpCodeBodySchema, request.body, reply);
      if (!body) return;
      void reply.header('cache-control', 'no-store');
      return service.totpBackup(current.session, body.code);
    }),
  );

  app.post(
    '/api/me/totp/disable',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      if (limited('totp-account', 20, request, reply)) return;
      const body = parse(totpCodeBodySchema, request.body, reply);
      if (!body) return;
      await service.totpDisable(current.session, body.code);
      return { ok: true };
    }),
  );

  app.post(
    '/api/auth/reset/request',
    guard(async (request, reply) => {
      if (limited('reset', 6, request, reply)) return;
      const body = parse(resetRequestSchema, request.body, reply);
      if (!body) return;
      await service.requestReset(body.login, request.ip, body.country);
      return { ok: true };
    }),
  );

  app.post(
    '/api/auth/reset/confirm',
    guard(async (request, reply) => {
      if (limited('reset', 6, request, reply)) return;
      const body = parse(resetConfirmSchema, request.body, reply);
      if (!body) return;
      await service.confirmReset(body.login, body.code, body.password, request.ip, body.country);
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
      const personaEntry = PERSONAS.find((item) => item.key === body.persona);
      // M122: the member's code mail follows the app language the request came in.
      const en = langOf(request) === 'en';
      const label = (en ? personaEntry?.labelEn : personaEntry?.label) ?? body.persona;
      const result = await personaChange.request(me.id, body.persona, async (code) => {
        try {
          await mailer?.send({
            to: [me.email],
            subject: en ? 'Your category change code — Investors Club' : 'رمز تغيير التوجه — نادي المستثمرين',
            text: en
              ? [`Your confirmation code for changing your category to "${label}": ${code}`, 'The code is valid for 10 minutes and for one use only.', '', 'You can change your category once per membership year.', 'If you did not ask for this change, ignore this message.'].join('\n')
              : [`رمز تأكيد تغيير توجهك إلى «${label}»: ${code}`, 'الرمز صالح لمدة 10 دقائق ولمرة واحدة فقط.', '', 'يمكنك تغيير توجهك مرة واحدة خلال سنة العضوية.', 'إذا لم تطلب هذا التغيير فتجاهل هذه الرسالة.'].join('\n'),
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
          // M109d: the owner's wording — the yearly change is used up; the dashboard request is the way.
          return reply.code(429).send({ error: { code: 'persona_cooldown', message: `يمكنك تغيير صفتك مرة واحدة فقط خلال السنة — متبقٍ ${result.daysLeft} يومًا. يمكنك إرسال «طلب تغيير الصفة» إلى الإدارة.`, daysLeft: result.daysLeft } });
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

  // M109d: where the member's persona stands — days left in the yearly window and his latest request.
  app.get(
    '/api/me/persona/state',
    guard(async (request, reply) => {
      if (!personaChange || !personaRequests) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      const [daysLeft, mine] = await Promise.all([me.isAdmin ? 0 : personaChange.daysLeft(me.id), personaRequests.mine(me.id)]);
      return { daysLeft, request: mine ? toMyPersonaRequest(mine) : null };
    }),
  );

  // M109d «طلب تغيير الصفة»: once the yearly change is used up, the member asks and the dashboard decides.
  app.post(
    '/api/me/persona/change-request',
    guard(async (request, reply) => {
      if (!personaChange || !personaRequests) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      if (limited('persona-request', 10, request, reply)) return;
      const body = parse(z.object({ persona: personaSchema, note: z.string().trim().max(300).default('') }), request.body, reply);
      if (!body) return;
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      if (me.persona === body.persona) {
        return reply.code(400).send({ error: { code: 'persona_same', message: 'هذا هو توجهك الحالي بالفعل' } });
      }
      const daysLeft = me.isAdmin ? 0 : await personaChange.daysLeft(me.id);
      if (daysLeft === 0) {
        return reply.code(400).send({ error: { code: 'window_open', message: 'تغييرك السنوي ما زال متاحًا — غيّر توجهك مباشرة بالرمز المرسل إلى بريدك' } });
      }
      const created = await personaRequests.create(me, auth.session.uuid, body.persona, body.note);
      return reply.code(201).send({ request: toMyPersonaRequest(created) });
    }),
  );

  // The dashboard's review: approve applies the persona at the hub first, so a failed hub call
  // leaves the request pending for a retry after the member signs in again.
  const requireDashboard = dashboardGuard(service);

  app.get(
    '/api/admin/persona-requests',
    guard(async (request, reply) => {
      if (!personaRequests) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      const admin = await requireDashboard(request, reply);
      if (!admin) return;
      const query = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), request.query, reply);
      if (!query) return;
      return { requests: (await personaRequests.list(query.status ?? null)).map(toAdminPersonaRequest) };
    }),
  );

  app.post(
    '/api/admin/persona-requests/:id/decision',
    guard(async (request, reply) => {
      if (!personaRequests) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      const admin = await requireDashboard(request, reply);
      if (!admin) return;
      const params = parse(z.object({ id: z.string().uuid() }), request.params, reply);
      if (!params) return;
      const body = parse(z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(300).default('') }), request.body, reply);
      if (!body) return;
      if (body.action === 'approve') {
        const pending = await personaRequests.pending(params.id);
        if (!pending) return reply.code(404).send({ error: { code: 'not_found', message: 'لا يوجد طلب قائم بهذا الرقم' } });
        try {
          await service.applyPersonaFor(pending.uuid, pending.to);
        } catch {
          return reply.code(409).send({
            error: { code: 'member_session_gone', message: 'تعذر تطبيق التغيير: جلسة العضو انتهت — اطلب منه فتح التطبيق وتسجيل الدخول ثم أعد المحاولة' },
          });
        }
        service.forget(pending.contactId);
      }
      const decided = await personaRequests.decide(params.id, body.action === 'approve' ? 'approved' : 'rejected', admin.me.name || admin.me.email, body.note);
      // M122: the push service maps the persona key to each language's label itself.
      push?.personaChangeDecided(decided.contactId, decided.status === 'approved', decided.to, decided.adminNote);
      return { request: toAdminPersonaRequest(decided) };
    }),
  );

  // M117: deleting is never instant any more — the old route now SCHEDULES the 30-day deletion
  // (pre-M117 app bundles still call it; they get the same grace window, just without the code step).
  app.delete(
    '/api/me',
    guard(async (request, reply) => {
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const body = parse(deleteSchema, request.body, reply);
      if (!body) return;
      const me = await service.me(auth.session);
      if (!(await service.passwordMatches(auth.session, body.password))) {
        return reply.code(403).send({ error: { code: 'bad_password', message: 'كلمة المرور غير صحيحة' } });
      }
      if (!deletion) {
        // Old tests without the store keep the original instant behaviour.
        await service.deleteAccount(auth.token, auth.session, body.password);
        notifier?.accountDeletionRequested({ email: me.email, name: me.name, phone: me.phone, note: body.reason ?? '', ip: request.ip });
        return { ok: true };
      }
      const row = await deletion.schedule({ contactId: me.id, uuid: auth.session.uuid, email: me.email, name: me.name, phone: me.phone }, body.reason ?? '');
      notifier?.accountDeletionRequested({ email: me.email, name: me.name, phone: me.phone, note: `${body.reason ?? ''} — حذف مجدول بعد ${DELETION_GRACE_DAYS} يومًا (${row.dueAt.slice(0, 10)})`, ip: request.ip });
      return { ok: true, dueAt: row.dueAt, daysLeft: DELETION_GRACE_DAYS };
    }),
  );

  // M117 «حذف الحساب على ثلاث خطوات»: password → an e-mailed code → the confirm word the app
  // shows. Nothing is deleted on the spot: the request is scheduled 30 days ahead, the member
  // keeps using the app with a countdown and may cancel any time; on the due day the management
  // is mailed to execute the hub deletion.
  app.post(
    '/api/me/delete/start',
    guard(async (request, reply) => {
      if (!deletion) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      if (limited('delete-start', 10, request, reply)) return;
      const body = parse(deleteSchema, request.body, reply);
      if (!body) return;
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      if (await deletion.statusOf(me.id)) {
        return reply.code(409).send({ error: { code: 'already_scheduled', message: 'حذف حسابك مجدول بالفعل' } });
      }
      if (!(await service.passwordMatches(auth.session, body.password))) {
        return reply.code(403).send({ error: { code: 'bad_password', message: 'كلمة المرور غير صحيحة' } });
      }
      // M122: the deletion code mail follows the app language the request came in.
      const en = langOf(request) === 'en';
      const result = await deletion.request(me.id, body.reason ?? '', async (code) => {
        try {
          await mailer?.send({
            to: [me.email],
            subject: en ? 'Your account deletion code — Investors Club' : 'رمز تأكيد حذف الحساب — نادي المستثمرين',
            text: en
              ? [`Your account deletion confirmation code: ${code}`, 'The code is valid for 10 minutes and for one use only.', '', `After you confirm, your account stays active for ${DELETION_GRACE_DAYS} days and you can cancel at any time during them.`, 'If you did not ask to delete your account, ignore this message and change your password.'].join('\n')
              : [`رمز تأكيد حذف حسابك: ${code}`, 'الرمز صالح لمدة 10 دقائق ولمرة واحدة فقط.', '', `بعد التأكيد يبقى حسابك فعالًا ${DELETION_GRACE_DAYS} يومًا ويمكنك التراجع خلالها في أي وقت.`, 'إذا لم تطلب حذف حسابك فتجاهل هذه الرسالة وغيّر كلمة مرورك.'].join('\n'),
          });
        } catch (error) {
          request.log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'deletion code was not mailed');
          throw new Error('mail_failed');
        }
      }).catch((cause: unknown) => {
        if (cause instanceof Error && cause.message === 'mail_failed') return null;
        throw cause;
      });
      if (!result) return reply.code(503).send({ error: { code: 'mail_failed', message: 'تعذر إرسال الرمز الآن، حاول بعد قليل' } });
      if (!result.ok) {
        if (result.reason === 'too_soon') return reply.code(429).send({ error: { code: 'delete_too_soon', message: `انتظر ${result.waitSeconds} ثانية قبل طلب رمز جديد` } });
        return reply.code(429).send({ error: { code: 'delete_too_many', message: 'طلبات كثيرة، حاول لاحقًا' } });
      }
      return { ok: true, email: me.email, seconds: result.seconds, word: result.word, days: DELETION_GRACE_DAYS };
    }),
  );

  app.post(
    '/api/me/delete/confirm',
    guard(async (request, reply) => {
      if (!deletion) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      if (limited('delete-confirm', 20, request, reply)) return;
      const body = parse(z.object({ code: codeSchema, word: z.string().trim().min(1, 'اكتب كلمة التأكيد').max(40) }), request.body, reply);
      if (!body) return;
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      const result = await deletion.confirm(me.id, body.code, body.word);
      if (!result.ok) {
        const message =
          result.reason === 'bad_code'
            ? `الرمز غير صحيح — متبقٍ ${result.attemptsLeft} محاولات`
            : result.reason === 'bad_word'
              ? 'كلمة التأكيد غير مطابقة — اكتبها كما تظهر لك'
              : result.reason === 'code_expired'
                ? 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا'
                : result.reason === 'locked'
                  ? 'محاولات خاطئة كثيرة، ابدأ من جديد'
                  : 'لا يوجد طلب حذف قائم، ابدأ من جديد';
        return reply.code(400).send({ error: { code: `delete_${result.reason}`, message } });
      }
      const row = await deletion.schedule({ contactId: me.id, uuid: auth.session.uuid, email: me.email, name: me.name, phone: me.phone }, result.reason);
      notifier?.accountDeletionRequested({ email: me.email, name: me.name, phone: me.phone, note: `${result.reason} — حذف مجدول بعد ${DELETION_GRACE_DAYS} يومًا (${row.dueAt.slice(0, 10)})`, ip: request.ip });
      return { ok: true, dueAt: row.dueAt, daysLeft: DELETION_GRACE_DAYS };
    }),
  );

  // The countdown the app shows in حسابي, and the member's way back.
  app.get(
    '/api/me/delete/state',
    guard(async (request, reply) => {
      if (!deletion) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      return { scheduled: await deletion.statusOf(me.id) };
    }),
  );

  app.post(
    '/api/me/delete/cancel',
    guard(async (request, reply) => {
      if (!deletion) return reply.code(404).send({ error: { code: 'off', message: 'غير متاح' } });
      const auth = await requireSession(request, reply);
      if (!auth) return;
      const me = await service.me(auth.session);
      const removed = await deletion.cancel(me.id);
      if (removed) notifier?.accountDeletionRequested({ email: me.email, name: me.name, phone: me.phone, note: 'تراجع العضو عن حذف حسابه — أُلغي الطلب المجدول.', ip: request.ip });
      return { ok: true, cancelled: removed };
    }),
  );
};
