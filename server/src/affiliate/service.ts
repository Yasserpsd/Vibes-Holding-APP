import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { InvitesService } from '../invites/service.js';
import type { Notifier } from '../mail/notify.js';
import type { KV } from '../store.js';

/**
 * M184: «برنامج ممثلي النادي» — the in-app affiliate program. Any signed-in account applies with
 * its full details (bank, address, how it heard of the club), receives the agreement by e-mail,
 * accepts it in the app, and ONLY the administration's approval in the dashboard activates it
 * (owner, 2026-11-02: «لازم ندوس من الداشبورد عشان نقبله»). The referral code is the member's
 * membership number — the same hub-verified channel as M32 invites — so a registration is never
 * attributed from the client, and a referral counts as PAID only when the server confirms the
 * membership activation (membership/service.ts and paylinks/service.ts call paid()).
 */
export const AFFILIATES_KEY = 'affiliate:records';
export const PAYOUTS_KEY = 'affiliate:payouts';
export const AFFILIATE_CONFIG_KEY = 'affiliate:config';
const MAX_PAYOUTS = 3000;

export type AffiliateStatus = 'agreement' | 'pending' | 'approved' | 'rejected';

export type AffiliateRecord = {
  contactId: number;
  name: string;
  email: string;
  phone: string;
  /** The membership number — the referral code the hub verifies at registration (M32 channel). */
  code: string;
  status: AffiliateStatus;
  /** The application form (owner, 2026-11-02: bank, IBAN, address, the source, and فرد/شركة are mandatory). */
  entityType: 'individual' | 'company';
  bankName: string;
  accountName: string;
  iban: string;
  city: string;
  address: string;
  heardFrom: string;
  heardFromNote: string;
  appliedAt: string;
  agreementSentAt: string;
  agreementAcceptedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
};

export type PayoutStatus = 'requested' | 'paid' | 'rejected';

export type PayoutRecord = {
  id: string;
  contactId: number;
  name: string;
  amount: number;
  bankName: string;
  accountName: string;
  iban: string;
  status: PayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
};

export type AffiliateConfig = {
  /** SAR per referred member who registered with the code AND paid the membership. */
  commission: number;
  /** Paid referrals required before «سحب الأرباح» opens (owner, 2026-11-02: «حد أدنى 5 أعضاء»). */
  minPayoutPaid: number;
  /** The full agreement (dashboard-editable); {commission} and {minPayout} become the current values. */
  agreementText: string;
  /** The program pitch shown in the app before applying. */
  introText: string;
  /** The same pitch for the English app (owner, 2026-11-02: «Club Affiliates Program»). */
  introTextEn: string;
  /** What the affiliate shares; {link} and {code} are filled per affiliate. */
  shareText: string;
  /** «كيف تعرّفت على نادي المستثمرين؟» options (owner: formal Arabic, many choices). */
  heardOptions: string[];
};

export const DEFAULT_HEARD_OPTIONS = [
  'منصة إكس',
  'الموقع الإلكتروني الرسمي',
  'تيك توك',
  'إنستغرام',
  'سناب شات',
  'يوتيوب',
  'لينكد إن',
  'بحث جوجل',
  'عن طريق صديق',
  'فعالية أو ملتقى',
  'أخرى',
];

/** Drafted protective of the club (owner's spec 2026-11-02); the owner edits it from the dashboard. */
export const DEFAULT_AGREEMENT = [
  'اتفاقية برنامج ممثلي نادي المستثمرين',
  '',
  'تمهيد: هذه الاتفاقية مبرمة بين شركة المجتمع الافتراضي للاستثمار، المشغّل الرسمي لنادي المستثمرين («النادي»)، وبين مقدّم الطلب («الممثل»). وبموافقة الممثل عليها إلكترونيًا من داخل التطبيق يقرّ بأنه قرأها وفهمها والتزم بجميع أحكامها.',
  '',
  'أولًا — نطاق عمل الممثل:',
  '1. يقتصر دور الممثل على التعريف بعضوية نادي المستثمرين ومزاياها كما هي معروضة داخل التطبيق الرسمي، ودعوة الراغبين إلى التسجيل عبر رابط الإحالة أو رمز الإحالة الخاص به.',
  '2. لا يجوز للممثل عرض أي مزايا أو أسعار أو وعود غير واردة في التطبيق، ولا تقديم أي استشارات استثمارية أو ضمانات أو توقعات بعوائد من أي نوع.',
  '',
  'ثانيًا — صفة الممثل:',
  '1. الممثل مسوّق مستقل، وليس موظفًا ولا وكيلًا ولا شريكًا للنادي، ولا يملك أي صلاحية للتعاقد أو الالتزام باسم النادي.',
  '2. لا يجوز للممثل استخدام اسم النادي أو شعاره إلا في حدود التعريف بالعضوية المشار إليه أعلاه، ويُمنع إنشاء حسابات أو صفحات أو مواقع توحي بأنها جهات رسمية تابعة للنادي.',
  '',
  'ثالثًا — حدود المسؤولية:',
  '1. لا يتحمّل النادي أي مسؤولية قانونية أو مالية من أي نوع عن أي تصرف يصدر من الممثل، أو عن أي إساءة استخدام لاسم النادي أو علامته، أو عن أي التزام يقطعه الممثل تجاه الغير.',
  '2. يتحمّل الممثل وحده كامل المسؤولية عن أساليب تسويقه وقنواته والتزامها بالأنظمة المعمول بها في المملكة العربية السعودية، ويلتزم بتعويض النادي عن أي ضرر ينشأ عن مخالفته لهذه الاتفاقية.',
  '',
  'رابعًا — التزامات النادي:',
  'تنحصر التزامات النادي في تقديم العضوية ومزاياها للأعضاء المسجّلين، وتشغيل برنامج الممثلين، واحتساب العمولات المستحقة وفق هذه الاتفاقية.',
  '',
  'خامسًا — العمولة:',
  '1. يستحق الممثل عمولة قدرها {commission} عن كل عضو سجّل عبر رمز الإحالة الخاص به وسدّد رسوم العضوية السنوية فعليًا. ولا تُستحق أي عمولة عن التسجيل وحده دون سداد.',
  '2. تُحتسب العمولات وفق سجلات النادي وأنظمته الإلكترونية، وهي المرجع الوحيد المعتمد في ذلك.',
  '3. تُصرف العمولات بناءً على طلب سحب يقدّمه الممثل من التطبيق، وتُحوَّل إلى حسابه البنكي المسجّل بعد مراجعة الطلب واعتماده من الإدارة.',
  '4. لا يُقدَّم طلب سحب للعمولات إلا بعد اكتمال {minPayout} أعضاء مسدّدين لرسوم العضوية عبر رمز الإحالة الخاص بالممثل.',
  '',
  'سادسًا — مدة الاتفاقية وإنهاؤها:',
  'للنادي قبول أي طلب انضمام أو رفضه دون إبداء الأسباب، وله إيقاف أي ممثل أو تعديل قيمة العمولة أو إنهاء البرنامج في أي وقت، مع حفظ حق الممثل في العمولات المستحقة له قبل الإنهاء.',
  '',
  'سابعًا — أحكام عامة:',
  'تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية، وتُعد الموافقة الإلكترونية من داخل التطبيق إقرارًا وتوقيعًا ملزمًا.',
].join('\n');

export const DEFAULT_AFFILIATE_CONFIG: AffiliateConfig = {
  commission: 250,
  minPayoutPaid: 5,
  agreementText: DEFAULT_AGREEMENT,
  // The owner's wording (2026-11-02), with the amounts dashboard-driven.
  introText:
    'انضم إلى برنامج ممثلي نادي المستثمرين: عرّف بعضوية النادي ومزاياها، ووظّف شبكة علاقاتك ومحيط معارفك، وادعُ المهتمين منهم إلى التسجيل عبر رابط مخصص لك، واحصل على عائد قدره {commission} عن كل عضو سجّل عبر رابطك وسدّد رسوم العضوية السنوية من خلاله. يخضع الانضمام لموافقة إدارة النادي بعد قبول الاتفاقية، ويتاح سحب العائد بعد اكتمال {minPayout} أعضاء مسدّدين.',
  introTextEn:
    "Join the Investors Club Affiliates Program and introduce others to the Club's membership and exclusive benefits. Leverage your professional network and personal connections to invite interested individuals to register through your unique referral link, and earn {commission} for every new member who registers through your link and pays the annual membership fee. Participation is subject to approval by the Club management following acceptance of the program agreement, and withdrawals unlock once {minPayout} referred members have paid.",
  shareText: [
    'أدعوك للانضمام إلى نادي المستثمرين Investors Club — مجتمع أعمال وشراكات وخدمات لروّاد الأعمال والمستثمرين.',
    'سجّل عبر رابطي الشخصي: {link}',
    'وعند التسجيل أدخل رمز الإحالة {code} في خانة «كود الدعوة».',
  ].join('\n'),
  heardOptions: DEFAULT_HEARD_OPTIONS,
};

/** What the affiliate sees about each referral (no contact details — only the hub holds those). */
export type AffiliateReferral = { name: string; at: string; paid: boolean };

export type AffiliateBalance = {
  commission: number;
  /** Paid referrals required before a payout may be requested (0 = no minimum). */
  minPaid: number;
  referrals: number;
  paid: number;
  unpaid: number;
  earned: number;
  /** Paid out + currently requested. */
  withdrawn: number;
  available: number;
};

type Deps = { kv: KV; invites: InvitesService; notifier: Notifier; log: FastifyBaseLogger; publicUrl: string };

export class AffiliateService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async loadRecords(): Promise<AffiliateRecord[]> {
    return (await this.deps.kv.get<{ affiliates: AffiliateRecord[] }>(AFFILIATES_KEY))?.affiliates ?? [];
  }

  private async loadPayouts(): Promise<PayoutRecord[]> {
    return (await this.deps.kv.get<{ payouts: PayoutRecord[] }>(PAYOUTS_KEY))?.payouts ?? [];
  }

  /** One writer at a time over both documents — same discipline as invites/service.ts. */
  private mutate<T>(change: (affiliates: AffiliateRecord[], payouts: PayoutRecord[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const [affiliates, payouts] = await Promise.all([this.loadRecords(), this.loadPayouts()]);
      const result = change(affiliates, payouts);
      affiliates.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
      payouts.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
      await this.deps.kv.set(AFFILIATES_KEY, { affiliates });
      await this.deps.kv.set(PAYOUTS_KEY, { payouts: payouts.slice(0, MAX_PAYOUTS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async config(): Promise<AffiliateConfig> {
    const stored = await this.deps.kv.get<Partial<AffiliateConfig>>(AFFILIATE_CONFIG_KEY);
    const options = (stored?.heardOptions ?? []).map((option) => option.trim()).filter(Boolean);
    return {
      commission: typeof stored?.commission === 'number' && stored.commission > 0 ? Math.round(stored.commission) : DEFAULT_AFFILIATE_CONFIG.commission,
      minPayoutPaid: typeof stored?.minPayoutPaid === 'number' && stored.minPayoutPaid >= 0 ? Math.round(stored.minPayoutPaid) : DEFAULT_AFFILIATE_CONFIG.minPayoutPaid,
      agreementText: stored?.agreementText?.trim() || DEFAULT_AFFILIATE_CONFIG.agreementText,
      introText: stored?.introText?.trim() || DEFAULT_AFFILIATE_CONFIG.introText,
      introTextEn: stored?.introTextEn?.trim() || DEFAULT_AFFILIATE_CONFIG.introTextEn,
      shareText: stored?.shareText?.trim() || DEFAULT_AFFILIATE_CONFIG.shareText,
      heardOptions: options.length ? options : DEFAULT_AFFILIATE_CONFIG.heardOptions,
    };
  }

  async saveConfig(input: Partial<AffiliateConfig>): Promise<AffiliateConfig> {
    const current = await this.config();
    const next: AffiliateConfig = {
      commission: input.commission !== undefined ? Math.round(input.commission) : current.commission,
      minPayoutPaid: input.minPayoutPaid !== undefined ? Math.max(0, Math.round(input.minPayoutPaid)) : current.minPayoutPaid,
      agreementText: (input.agreementText ?? current.agreementText).trim() || DEFAULT_AFFILIATE_CONFIG.agreementText,
      introText: (input.introText ?? current.introText).trim() || DEFAULT_AFFILIATE_CONFIG.introText,
      introTextEn: (input.introTextEn ?? current.introTextEn).trim() || DEFAULT_AFFILIATE_CONFIG.introTextEn,
      shareText: (input.shareText ?? current.shareText).trim() || DEFAULT_AFFILIATE_CONFIG.shareText,
      heardOptions: (input.heardOptions ?? current.heardOptions).map((option) => option.trim()).filter(Boolean),
    };
    if (!next.heardOptions.length) next.heardOptions = DEFAULT_AFFILIATE_CONFIG.heardOptions;
    await this.deps.kv.set(AFFILIATE_CONFIG_KEY, next);
    return next;
  }

  /** The amount in words the texts carry («250 ريال سعودي»). */
  static commissionLabel(commission: number): string {
    return `${commission} ريال سعودي`;
  }

  /** The same amount for the English app («SAR 250»). */
  static commissionLabelEn(commission: number): string {
    return `SAR ${commission}`;
  }

  referralLink(code: string): string {
    const base = this.deps.publicUrl.replace(/\/+$/, '');
    return base ? `${base}/r/${encodeURIComponent(code)}` : '';
  }

  async find(contactId: number): Promise<AffiliateRecord | null> {
    return (await this.loadRecords()).find((record) => record.contactId === contactId) ?? null;
  }

  async findByCode(code: string): Promise<AffiliateRecord | null> {
    const wanted = code.trim().toUpperCase();
    return (await this.loadRecords()).find((record) => record.code.toUpperCase() === wanted) ?? null;
  }

  /**
   * The application (or a re-application after a rejection, or an update while the agreement is
   * still unaccepted). The agreement goes out by e-mail at once; approval stays the dashboard's.
   */
  async apply(
    member: { contactId: number; name: string; email: string; phone: string; code: string },
    form: { entityType: 'individual' | 'company'; bankName: string; accountName: string; iban: string; city: string; address: string; heardFrom: string; heardFromNote: string },
    now = new Date(),
  ): Promise<AffiliateRecord> {
    const config = await this.config();
    if (!config.heardOptions.includes(form.heardFrom)) {
      throw new RequestError('heard_from', 'اختر كيف تعرّفت على النادي من القائمة', 400);
    }
    const record = await this.mutate((affiliates) => {
      const existing = affiliates.find((entry) => entry.contactId === member.contactId);
      if (existing && (existing.status === 'approved' || existing.status === 'pending')) {
        throw new RequestError('affiliate_exists', existing.status === 'approved' ? 'أنت ممثل معتمد بالفعل' : 'طلبك قيد مراجعة الإدارة', 400);
      }
      const next: AffiliateRecord = {
        contactId: member.contactId,
        name: member.name,
        email: member.email,
        phone: member.phone,
        code: member.code,
        status: 'agreement',
        ...form,
        appliedAt: now.toISOString(),
        agreementSentAt: now.toISOString(),
        agreementAcceptedAt: null,
        decidedAt: null,
        decidedBy: null,
        adminNote: null,
      };
      if (existing) affiliates.splice(affiliates.indexOf(existing), 1);
      affiliates.push(next);
      return next;
    });
    // The mail fills {commission}; {minPayout} is filled here so the mailed agreement reads whole.
    this.deps.notifier.affiliateAgreement(record, config.agreementText.replaceAll('{minPayout}', String(config.minPayoutPaid)), AffiliateService.commissionLabel(config.commission));
    return record;
  }

  /** The applicant accepted the agreement in the app — now the request waits for the dashboard. */
  async acceptAgreement(contactId: number, now = new Date()): Promise<AffiliateRecord> {
    const result = await this.mutate((affiliates) => {
      const existing = affiliates.find((entry) => entry.contactId === contactId);
      if (!existing || existing.status === 'rejected') throw new RequestError('no_application', 'قدّم طلب الانضمام أولًا', 400);
      const accepted = existing.status === 'agreement';
      if (accepted) {
        existing.agreementAcceptedAt = now.toISOString();
        existing.status = 'pending';
      }
      return { record: { ...existing }, accepted };
    });
    if (result.accepted) this.deps.notifier.affiliateApplied(result.record);
    return result.record;
  }

  /** The dashboard's decision — the only way an affiliate becomes active (owner, 2026-11-02). */
  async decide(contactId: number, status: 'approved' | 'rejected', note: string, adminName: string, now = new Date()): Promise<AffiliateRecord | null> {
    const record = await this.mutate((affiliates) => {
      const existing = affiliates.find((entry) => entry.contactId === contactId);
      if (!existing) return null;
      if (status === 'approved' && !existing.agreementAcceptedAt) {
        throw new RequestError('agreement_pending', 'لم يوافق مقدّم الطلب على الاتفاقية بعد', 400);
      }
      existing.status = status;
      existing.decidedAt = now.toISOString();
      existing.decidedBy = adminName;
      existing.adminNote = note.trim() || null;
      return { ...existing };
    });
    if (record) this.deps.notifier.affiliateDecided(record, this.referralLink(record.code));
    return record;
  }

  /** The affiliate's referrals: every hub-verified registration with his code, paid = membership activated. */
  async referrals(contactId: number): Promise<AffiliateReferral[]> {
    const mine = await this.deps.invites.mine(contactId);
    return mine.map((person) => ({ name: person.name, at: person.at, paid: person.state === 'member' }));
  }

  async balance(contactId: number): Promise<AffiliateBalance> {
    const [config, referrals, payouts] = await Promise.all([this.config(), this.referrals(contactId), this.loadPayouts()]);
    const paid = referrals.filter((person) => person.paid).length;
    const withdrawn = payouts
      .filter((payout) => payout.contactId === contactId && payout.status !== 'rejected')
      .reduce((sum, payout) => sum + payout.amount, 0);
    const earned = paid * config.commission;
    return {
      commission: config.commission,
      minPaid: config.minPayoutPaid,
      referrals: referrals.length,
      paid,
      unpaid: referrals.length - paid,
      earned,
      withdrawn,
      available: Math.max(0, earned - withdrawn),
    };
  }

  async myPayouts(contactId: number): Promise<PayoutRecord[]> {
    return (await this.loadPayouts()).filter((payout) => payout.contactId === contactId);
  }

  /** «سحب الأرباح»: the full available balance, to the bank details the affiliate confirms in the form. */
  async requestPayout(contactId: number, bank: { bankName: string; accountName: string; iban: string }, now = new Date()): Promise<PayoutRecord> {
    const balance = await this.balance(contactId);
    const payout = await this.mutate((affiliates, payouts) => {
      const affiliate = affiliates.find((entry) => entry.contactId === contactId);
      if (!affiliate || affiliate.status !== 'approved') throw new RequestError('not_affiliate', 'هذه الخدمة لممثلي النادي المعتمدين', 403);
      if (payouts.some((entry) => entry.contactId === contactId && entry.status === 'requested')) {
        throw new RequestError('payout_open', 'لديك طلب سحب قيد المراجعة بالفعل', 400);
      }
      // Owner (2026-11-02): «حد أدنى للسحب 5 أعضاء» — paid members, dashboard-adjustable.
      if (balance.paid < balance.minPaid) {
        throw new RequestError('payout_min', `يتاح سحب الأرباح بعد اكتمال ${balance.minPaid} أعضاء مسدّدين لرسوم العضوية عبر رمزك، وعدد المسدّدين لديك الآن ${balance.paid}`, 400);
      }
      if (balance.available <= 0) throw new RequestError('no_balance', 'لا يوجد رصيد متاح للسحب حاليًا', 400);
      // The payout form is the freshest bank data — keep the affiliate record in step for the dashboard.
      affiliate.bankName = bank.bankName;
      affiliate.accountName = bank.accountName;
      affiliate.iban = bank.iban;
      const record: PayoutRecord = {
        id: randomUUID(),
        contactId,
        name: affiliate.name,
        amount: balance.available,
        ...bank,
        status: 'requested',
        requestedAt: now.toISOString(),
        decidedAt: null,
        decidedBy: null,
        adminNote: null,
      };
      payouts.push(record);
      return record;
    });
    this.deps.notifier.affiliatePayoutRequested(payout);
    return payout;
  }

  /** The dashboard marks the manual bank transfer done (or refuses the request with a note). */
  async decidePayout(id: string, status: 'paid' | 'rejected', note: string, adminName: string, now = new Date()): Promise<PayoutRecord | null> {
    const result = await this.mutate((affiliates, payouts) => {
      const payout = payouts.find((entry) => entry.id === id);
      if (!payout || payout.status !== 'requested') return null;
      payout.status = status;
      payout.decidedAt = now.toISOString();
      payout.decidedBy = adminName;
      payout.adminNote = note.trim() || null;
      return { payout: { ...payout }, email: affiliates.find((entry) => entry.contactId === payout.contactId)?.email ?? '' };
    });
    if (result) this.deps.notifier.affiliatePayoutDecided(result.payout, result.email);
    return result?.payout ?? null;
  }

  async list(): Promise<AffiliateRecord[]> {
    return this.loadRecords();
  }

  async listPayouts(): Promise<PayoutRecord[]> {
    return this.loadPayouts();
  }
}
