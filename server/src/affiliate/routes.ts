import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sessionGuard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import { langOf } from '../lang.js';
import type { NameTransliterator } from '../auth/namesEnglish.js';
import { APP_STORE_BADGE, PLAY_STORE_BADGE } from '../legal/badges.js';
import { APP_STORE_URL, PLAY_STORE_URL } from '../legal/applink.js';
import { cityChoices, cityKeyOf } from './cities.js';
import { ibanIssueMessage, saudiIbanIssue } from './iban.js';
import { AffiliateService, type AffiliateRecord } from './service.js';

export type AffiliateRoutesOptions = { service: AffiliateService; auth: AuthService; names?: NameTransliterator };

/** M195: a Saudi IBAN (SA + 22, mod-97 checked); spaces and case are forgiven. */
const ibanSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .superRefine((value, ctx) => {
    const issue = saudiIbanIssue(value);
    if (issue) ctx.addIssue({ code: 'custom', message: ibanIssueMessage(issue) });
  });

const bankSchema = {
  bankName: z.string().trim().min(2, 'اكتب اسم البنك').max(80),
  // Owner (2026-11-02): the bank account details are English — the rest of the form takes Arabic freely.
  accountName: z
    .string()
    .trim()
    .min(2, 'اكتب اسم صاحب الحساب كما هو مسجّل في البنك')
    .max(120)
    // M195: letters only (spaces, dots, apostrophes and hyphens inside), as the owner asked.
    .regex(/^[A-Za-z][A-Za-z\s.'’-]*$/, 'اكتب اسم صاحب الحساب بالأحرف الإنجليزية فقط كما هو مسجّل لدى البنك'),
  iban: ibanSchema,
};

const applySchema = z.object({
  // Owner, 2026-11-02: the applicant must say whether he applies as a person or a company.
  entityType: z.enum(['individual', 'company'], { message: 'حدّد هل تقدّم الطلب بصفتك فردًا أم شركة' }),
  ...bankSchema,
  // M195: a list key ('other' + cityOther), or a bare city name from an older bundle (the service resolves it).
  city: z.string().trim().min(2, 'اختر مدينة الإقامة').max(60),
  cityOther: z.string().trim().max(60).default(''),
  address: z.string().trim().min(10, 'اكتب عنوانًا فعليًا: الحي والشارع ورقم المبنى').max(240),
  heardFrom: z.string().trim().min(2, 'اختر كيف عرفت عن نادي المستثمرين').max(60),
  heardFromNote: z.string().trim().max(200).default(''),
});

const payoutSchema = z.object(bankSchema);

const decisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).default(''),
});

const payoutDecisionSchema = z.object({
  status: z.enum(['paid', 'rejected']),
  note: z.string().trim().max(300).default(''),
});

const configSchema = z
  .object({
    commission: z.number().int().min(1, 'العمولة بالريال السعودي').max(100000),
    commissionMember: z.number().int().min(1, 'عمولة الممثل المشترك بالريال السعودي').max(100000),
    cycleDays: z.number().int().min(1, 'مدة الدورة بالأيام').max(365),
    cycleTarget: z.number().int().min(1, 'هدف الدورة بعدد الأعضاء الدافعين').max(1000),
    cycleBonus: z.number().int().min(0, 'البدل بالريال السعودي').max(1000000),
    minPayoutPaid: z.number().int().min(0, 'الحد الأدنى للسحب بعدد الأعضاء المسدّدين').max(1000),
    agreementText: z.string().trim().min(100, 'نص الاتفاقية قصير جدًا').max(20000),
    agreementTextEn: z.string().trim().min(100, 'The English agreement is too short').max(20000),
    introText: z.string().trim().min(20, 'اكتب تعريف البرنامج').max(2000),
    introTextEn: z.string().trim().min(20, 'Write the program pitch in English').max(2000),
    shareText: z.string().trim().min(10, 'اكتب نص المشاركة').max(1000),
    heardOptions: z.array(z.string().trim().min(1).max(60)).min(2).max(30),
    heardOptionsEn: z.array(z.string().trim().max(80)).max(30),
    reminderEnabled: z.boolean(),
    reminderTitle: z.string().trim().min(3, 'اكتب عنوان التذكير').max(80),
    reminderBody: z.string().trim().min(10, 'اكتب نص التذكير').max(400),
    reminderTitleEn: z.string().trim().min(3, 'Write the reminder title').max(80),
    reminderBodyEn: z.string().trim().min(10, 'Write the reminder text').max(400),
  })
  .partial();

const cycleSchema = z.object({
  days: z.number().int().min(1, 'مدة الدورة بالأيام').max(365),
  target: z.number().int().min(1, 'عدد الأعضاء الدافعين المطلوب').max(1000),
  bonus: z.number().int().min(0, 'البدل بالريال السعودي').max(1000000),
});

const contactIdSchema = z.object({ contactId: z.coerce.number().int().positive() });
const idSchema = z.object({ id: z.string().uuid() });

/** What the member's own screen needs about his application (bank data comes back for prefill). */
function ownApplication(record: AffiliateRecord) {
  return {
    status: record.status,
    entityType: record.entityType,
    bankName: record.bankName,
    accountName: record.accountName,
    iban: record.iban,
    city: record.city,
    address: record.address,
    heardFrom: record.heardFrom,
    heardFromNote: record.heardFromNote,
    // M195: the city as a list key so a re-application prefills the picker.
    cityKey: cityKeyOf(record.city),
    appliedAt: record.appliedAt,
    agreementAcceptedAt: record.agreementAcceptedAt,
    adminNote: record.status === 'rejected' ? record.adminNote : null,
  };
}

/**
 * M184: «برنامج ممثلي نادي المستثمرين». The member applies with his full details, accepts the mailed
 * agreement in the app, and the dashboard's approval alone activates him. The referral code is his
 * membership number (the hub-verified M32 channel); «paid» comes only from the server-confirmed
 * membership activation.
 */
export const affiliateRoutes: FastifyPluginAsync<AffiliateRoutesOptions> = async (app, { service, auth, names }) => {
  const requireSession = sessionGuard(auth);
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/affiliate',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const me = await auth.me(current.session);
      // M186: every visit brings the counter, the stamps and the allowance up to date with the hub's fresh membership.
      await service.sync(me.id, new Date(), { active: me.membership.status === 'active', endDate: me.membership.endDate });
      const [config, record] = await Promise.all([service.config(), service.find(me.id)]);
      // The texts follow the app's language (owner, 2026-11-02); the Arabic agreement stays the authoritative one.
      const lang = langOf(request);
      const fill = (text: string) => AffiliateService.fillTerms(text, config, lang === 'en' ? 'en' : 'ar');
      const base = {
        status: record?.status ?? ('none' as const),
        commission: config.commission,
        commissionMember: config.commissionMember,
        minPayoutPaid: config.minPayoutPaid,
        introText: fill(lang === 'en' ? config.introTextEn : config.introText),
        agreementText: fill(lang === 'en' ? config.agreementTextEn : config.agreementText),
        heardOptions: config.heardOptions,
        // M195: the same options labelled in the app's language, and the Saudi cities to pick from.
        heardChoices: AffiliateService.heardChoices(config, lang === 'en' ? 'en' : 'ar'),
        cities: cityChoices(lang === 'en' ? 'en' : 'ar'),
        application: record ? ownApplication(record) : null,
      };
      if (record?.status !== 'approved') return base;
      // M198: the member shares his short alias; the membership number stays the hub's referral key.
      const code = AffiliateService.codeOf(record);
      const link = service.referralLink(code);
      const [referrals, balance, payouts, cycle] = await Promise.all([
        service.referrals(me.id),
        service.balance(me.id),
        service.myPayouts(me.id),
        service.cycleView(me.id),
      ]);
      return {
        ...base,
        code,
        membershipCode: record.code,
        link,
        shareText: config.shareText.replaceAll('{link}', link || code).replaceAll('{code}', code),
        // Owner (2026-11-04): the English app shows the referred people's names in Latin letters.
        referrals: names ? await localizeReferrals(referrals, names, lang) : referrals,
        balance,
        cycle,
        payouts: payouts.map((payout) => ({
          id: payout.id,
          amount: payout.amount,
          status: payout.status,
          requestedAt: payout.requestedAt,
          decidedAt: payout.decidedAt,
          adminNote: payout.adminNote,
        })),
      };
    }),
  );

  app.post(
    '/api/affiliate/apply',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(applySchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const record = await service.apply(
        { contactId: me.id, name: me.name, email: me.email, phone: me.phone, code: me.cardNumber },
        input,
        new Date(),
        langOf(request),
      );
      return { application: ownApplication(record) };
    }),
  );

  app.post(
    '/api/affiliate/agreement',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const me = await auth.me(current.session);
      const record = await service.acceptAgreement(me.id);
      return { application: ownApplication(record) };
    }),
  );

  app.post(
    '/api/affiliate/payout',
    guard(async (request, reply) => {
      const current = await requireSession(request, reply);
      if (!current) return;
      const input = parse(payoutSchema, request.body, reply);
      if (!input) return;
      const me = await auth.me(current.session);
      const payout = await service.requestPayout(me.id, input);
      return { payout: { id: payout.id, amount: payout.amount, status: payout.status, requestedAt: payout.requestedAt, decidedAt: null, adminNote: null } };
    }),
  );

  // ——— The dashboard ———

  app.get(
    '/api/admin/affiliates',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const [affiliates, payouts, config] = await Promise.all([service.list(), service.listPayouts(), service.config()]);
      const rows = await Promise.all(
        affiliates.map(async (record) => ({
          ...record,
          stats: await service.balance(record.contactId),
          cycle: await service.cycleView(record.contactId),
        })),
      );
      return { affiliates: rows, payouts, config };
    }),
  );

  app.post(
    '/api/admin/affiliates/config',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const input = parse(configSchema, request.body, reply);
      if (!input) return;
      return { config: await service.saveConfig(input) };
    }),
  );

  app.post(
    '/api/admin/affiliates/payouts/:id/decision',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(idSchema, request.params, reply);
      if (!params) return;
      const input = parse(payoutDecisionSchema, request.body, reply);
      if (!input) return;
      const payout = await service.decidePayout(params.id, input.status, input.note, admin.me.name || admin.me.email);
      if (!payout) return reply.code(404).send({ error: { code: 'not_found', message: 'طلب السحب غير موجود أو سبق البت فيه' } });
      return { payout };
    }),
  );

  app.post(
    '/api/admin/affiliates/:contactId/decision',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(contactIdSchema, request.params, reply);
      if (!params) return;
      const input = parse(decisionSchema, request.body, reply);
      if (!input) return;
      const record = await service.decide(params.contactId, input.status, input.note, admin.me.name || admin.me.email);
      if (!record) return reply.code(404).send({ error: { code: 'not_found', message: 'الطلب غير موجود' } });
      return { affiliate: { ...record, stats: await service.balance(record.contactId) } };
    }),
  );

  /** M186: renew the counter (the request filed when it ran out) or restart it early with new terms. */
  app.post(
    '/api/admin/affiliates/:contactId/cycle',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const params = parse(contactIdSchema, request.params, reply);
      if (!params) return;
      const input = parse(cycleSchema, request.body, reply);
      if (!input) return;
      const record = await service.renewCycle(params.contactId, input);
      if (!record) return reply.code(404).send({ error: { code: 'not_found', message: 'الممثل غير موجود' } });
      return { affiliate: { ...record, stats: await service.balance(record.contactId), cycle: await service.cycleView(record.contactId) } };
    }),
  );

  // ——— The public referral link ———

  /** The affiliate's personal link: the download page carrying his code; an unknown code falls back to /app. */
  app.get('/r/:code', async (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const code = String((request.params as { code?: string }).code ?? '').trim();
    const record = code ? await service.findByCode(code) : null;
    if (!record || record.status !== 'approved') return reply.redirect('/app', 302);
    return reply.header('content-type', 'text/html; charset=utf-8').send(referralPage(AffiliateService.codeOf(record)));
  });
};

const CLUB_LOGO_URL =
  'https://vcmem.com/wp-content/uploads/2025/11/%D9%84%D9%88%D8%AC%D9%88-%D9%86%D8%A7%D8%AF%D9%8A-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AB%D9%85%D8%B1%D9%8A%D9%86-%D8%AC%D9%88%D9%88%D9%84%D8%AF-%D8%B4%D9%81%D8%A7%D9%81.png';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The M133 download-page look (white, bilingual, official badges) with the referral code as the hero. */
export function referralPage(code: string): string {
  const safe = escapeHtml(code);
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Investors Club — سجّل برمز الإحالة ${safe}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
body{margin:0;background:#fff;color:#0d274a;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.card{max-width:440px;width:100%;text-align:center;border:1px solid #e7ad3f;border-radius:24px;padding:36px 28px;box-shadow:0 24px 60px rgba(13,39,74,.12)}
.logo{width:130px;height:130px;object-fit:contain;display:block;margin:0 auto 16px}
h1{font-size:21px;margin:0 0 4px;line-height:1.4}
h2{font-size:16px;font-weight:600;margin:0 0 14px;direction:ltr}
p{font-size:14.5px;line-height:1.8;color:#4A5568;margin:0 0 6px}
p.en{direction:ltr;font-size:13px;margin-bottom:14px}
.code{direction:ltr;font-size:24px;font-weight:700;letter-spacing:2px;color:#0d274a;border:1.5px dashed #e7ad3f;border-radius:14px;padding:12px 10px;margin:4px 0 8px;background:#fffdf6}
.copy{font-size:13px;border:none;background:#0d274a;color:#fff;border-radius:10px;padding:9px 18px;font-family:inherit;cursor:pointer;margin-bottom:14px}
.badges{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0 10px}
.badges a{line-height:0}.badges img{height:48px;width:auto;border-radius:8px}
.hint{font-size:12px;color:#718096;margin-top:8px}
</style></head><body>
<div class="card">
<img class="logo" alt="Investors Club" src="${CLUB_LOGO_URL}">
<h1>انضم إلى نادي المستثمرين</h1>
<h2>Join the Investors Club</h2>
<p>حمّل تطبيق Investors Club، وعند التسجيل أدخل رمز الإحالة التالي في خانة «كود الدعوة»:</p>
<p class="en">Download the app and enter this referral code in the "Invite code" field at sign-up:</p>
<div class="code" id="ref-code">${safe}</div>
<button class="copy" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText('${safe}');this.textContent='تم النسخ ✓'">نسخ الرمز · Copy</button>
<div class="badges">
<a href="${APP_STORE_URL}" aria-label="App Store"><img alt="Download on the App Store" src="${APP_STORE_BADGE}"></a>
<a href="${PLAY_STORE_URL}" aria-label="Google Play"><img alt="Get it on Google Play" src="${PLAY_STORE_BADGE}"></a>
</div>
<div class="hint">اضغط على الشعار للتحميل · Tap the badge to download</div>
</div></body></html>`;
}

async function localizeReferrals<T extends { name: string }>(rows: T[], names: NameTransliterator, lang: ReturnType<typeof langOf>): Promise<T[]> {
  const shown = await names.names(rows.map((row) => row.name), lang).catch(() => rows.map((row) => row.name));
  return rows.map((row, index) => ({ ...row, name: shown[index] ?? row.name }));
}
