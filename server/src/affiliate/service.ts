import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { RequestError } from '../auth/guard.js';
import type { InvitesService } from '../invites/service.js';
import type { Notifier } from '../mail/notify.js';
import type { AppLang } from '../lang.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';

import { cityByKey, cityKeyOf, CITY_NAME, OTHER_CITY } from './cities.js';
import type { WaResult, WhatsappService } from '../whatsapp/service.js';
import { codeKey, isLegacyCode, newShortCode, normalizeShortCode } from './shortCode.js';

/**
 * M184: «برنامج ممثلي نادي المستثمرين» — the in-app affiliate program. Any signed-in account applies with
 * its full details (bank, address, how it heard of the club), receives the agreement by e-mail,
 * accepts it in the app, and ONLY the administration's approval in the dashboard activates it
 * (owner, 2026-11-02: «لازم ندوس من الداشبورد عشان نقبله»). The referral code is the member's
 * membership number — the same hub-verified channel as M32 invites — so a registration is never
 * attributed from the client, and a referral counts as PAID only when the server confirms the
 * membership activation (membership/service.ts and paylinks/service.ts call paid()).
 *
 * M186 (owner, 2026-11-02): «ممثلو نادي المستثمرين» v3 — the commission follows the affiliate's own
 * membership AT THE MOMENT each referral pays (250 / 350, stamped once into `earnings`, so a lapsed
 * membership never rewrites what was earned); every affiliate runs a performance cycle (default 30
 * days, 10 paying members, 1,500 SAR transport and incidentals allowance, once per cycle); when the
 * cycle's counter runs out the server files a renewal request to the team and the dashboard renews
 * it with a new duration, target and allowance.
 */
export const AFFILIATES_KEY = 'affiliate:records';
export const PAYOUTS_KEY = 'affiliate:payouts';
export const AFFILIATE_CONFIG_KEY = 'affiliate:config';
export const REMINDER_KEY = 'affiliate:reminder';
/** M194: the daily reminder goes out in this Riyadh hour (19:00–19:59). */
export const REMINDER_HOUR = 19;
const MAX_PAYOUTS = 3000;
/** M195: names compared loosely (spaces, case, hamza forms) when an address is checked against them. */
const foldName = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
/** M195: words that make a line an address («حي», «شارع», "street", "building"…) — mirrors app/src/lib/validation.ts. */
const ADDRESS_WORDS =
  /(حي|شارع|طريق|مبنى|مبني|عمارة|عماره|رقم|شقة|شقه|الدور|فيلا|فله|فلة|مجمع|مخطط|بجوار|بجانب|قرب|مقابل|تقاطع|دوار|ميدان|street|st\.|road|rd\.|district|dist\.|building|bldg|apartment|apt|villa|unit|floor|near|next to|avenue|ave\.|tower|complex|compound|block|p\.?o\.? box|zip)/i;
/** A few letter-only words with no digit, no punctuation and no address word read as a person's name («Abdulrahman AlAswad»). */
export function looksLikePersonName(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim();
  if (/[0-9٠-٩]/.test(text) || /[,،;:/\-–()]/.test(text) || ADDRESS_WORDS.test(text)) return false;
  const words = text.split(' ');
  return words.length <= 4 && words.every((word) => /^[\u0600-\u06FFA-Za-z'’.]+$/.test(word));
}
const DAY_MS = 86_400_000;

export type AffiliateStatus = 'agreement' | 'pending' | 'approved' | 'rejected';

export type AffiliateRecord = {
  contactId: number;
  name: string;
  email: string;
  phone: string;
  /** The membership number — the referral code the hub verifies at registration (M32 channel). */
  code: string;
  /**
   * M198 + M202: the short alias the member shares instead («FAR2»: three Latin letters of his name + one
   * digit). The server maps it back to `code` before the hub ever sees it. Older records get theirs
   * on the next load.
   */
  shortCode?: string;
  /** M202: every alias he shared before; links and typed codes carrying them keep resolving to him. */
  oldCodes?: string[];
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
  /** M195: the applicant's app language — his agreement and decision mails follow it. */
  lang?: AppLang;
  appliedAt: string;
  agreementSentAt: string;
  agreementAcceptedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
  /** M186: the affiliate's own membership as last seen through the hub (decides the commission tier). */
  membership?: { active: boolean; endDate: string | null; seenAt: string };
  /** M186: one stamp per paid referral — the amount is fixed the moment it is counted. */
  earnings?: AffiliateEarning[];
  /** M186: performance cycles, oldest first; the last one is the current counter. */
  cycles?: AffiliateCycle[];
  /** M186: set when the current cycle ran out — the dashboard's renewal clears it. */
  renewalRequestedAt?: string | null;
};

export type AffiliateEarning = { inviteId: string; name: string; paidAt: string; amount: number; member: boolean };

export type AffiliateCycle = {
  n: number;
  startAt: string;
  endAt: string;
  /** Paying members needed inside the window for the allowance. */
  target: number;
  /** SAR — the transport and incidentals allowance («بدل مواصلات ومصروفات نثرية»). */
  bonus: number;
  /** When the target was reached and the allowance joined the balance. */
  bonusAt: string | null;
  /** When the counter ran out (or the dashboard renewed early); `paid` is frozen then. */
  closedAt: string | null;
  paid: number | null;
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
  /** SAR per referred member who registered with the code AND paid the membership (affiliate without a membership). */
  commission: number;
  /** M186: the same commission when the affiliate holds an active annual membership. */
  commissionMember: number;
  /** M186: the default performance cycle — days, paying members, allowance in SAR (0 = no allowance). */
  cycleDays: number;
  cycleTarget: number;
  cycleBonus: number;
  /** Paid referrals required before «سحب الأرباح» opens (owner, 2026-11-02: «حد أدنى 5 أعضاء»). */
  minPayoutPaid: number;
  /** The full agreement (dashboard-editable); {commission} and {minPayout} become the current values. */
  agreementText: string;
  /** The agreement for the English app (owner, 2026-11-02); the Arabic text stays the authoritative one. */
  agreementTextEn: string;
  /** The program pitch shown in the app before applying. */
  introText: string;
  /** The same pitch for the English app (owner, 2026-11-02: «Club Affiliates Program»). */
  introTextEn: string;
  /** What the affiliate shares; {link} and {code} are filled per affiliate. */
  shareText: string;
  /** «كيف تعرّفت على نادي المستثمرين؟» options (owner: formal Arabic, many choices). */
  heardOptions: string[];
  /** M195: the same options in English, line by line (the English app's labels); a missing line falls back to the Arabic. */
  heardOptionsEn: string[];
  /** M194: the advisor's daily push to approved affiliates with no paying member yet (dashboard switch + texts). */
  reminderEnabled: boolean;
  reminderTitle: string;
  reminderBody: string;
  reminderTitleEn: string;
  reminderBodyEn: string;
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

/** M195: the English labels of DEFAULT_HEARD_OPTIONS, same order (the English app shows these). */
export const DEFAULT_HEARD_OPTIONS_EN = [
  'X (Twitter)',
  'The official website',
  'TikTok',
  'Instagram',
  'Snapchat',
  'YouTube',
  'LinkedIn',
  'Google search',
  'A friend',
  'An event or meetup',
  'Other',
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
  'خامسًا — العمولات المستحقة:',
  '1. يستحق الممثل غير المشترك في العضوية السنوية عمولة قدرها {commission} عن كل عضو سجّل عبر رمز الإحالة الخاص به وسدّد رسوم العضوية السنوية فعليًا.',
  '2. يستحق الممثل المشترك في العضوية السنوية عمولة قدرها {commissionMember} عن كل عضو دافع بالشروط ذاتها.',
  '3. تُحدَّد فئة العمولة بحالة عضوية الممثل في تاريخ سداد العضو المُحال، وتثبت العمولة عن ذلك العضو عند احتسابها. ولا تُستحق أي عمولة عن التسجيل وحده دون سداد.',
  '4. تُحتسب العمولات وفق سجلات النادي وأنظمته الإلكترونية، وهي المرجع الوحيد المعتمد في ذلك.',
  '',
  'سادسًا — بدل المواصلات والمصروفات النثرية:',
  '1. يحصل الممثل على مبلغ {bonus} بدل مواصلات ومصروفات نثرية، دعمًا إضافيًا من إدارة النادي، متى نجح في استقطاب {bonusTarget} أعضاء دافعين خلال دورة أداء مدتها {bonusDays} يومًا، سواء كان مشتركًا في العضوية السنوية أو غير مشترك.',
  '2. تبدأ دورة الأداء الأولى من تاريخ اعتماد الممثل، ويعرض التطبيق عدّادًا بالأيام المتبقية وعدد الأعضاء الدافعين خلالها. وعند انتهاء الدورة ترفع المنظومة طلب تجديد إلى الإدارة، وتُجدَّد الدورة بالمدة والعدد والمبلغ الذي تحدده الإدارة.',
  '3. يُستحق البدل مرة واحدة عن كل دورة، ويُضاف إلى رصيد الممثل ويُصرف وفق أحكام صرف العمولات.',
  '',
  'سابعًا — صرف المستحقات:',
  '1. الحد الأدنى لصرف المستحقات وتحويلها هو استقطاب {minPayout} أعضاء دافعين عبر رمز الإحالة الخاص بالممثل، سواء كان مشتركًا في العضوية السنوية أو غير مشترك.',
  '2. تُرحَّل العمولات المستحقة وتبقى محفوظة في رصيد الممثل إلى حين بلوغ الحد الأدنى المطلوب للصرف.',
  '3. تُصرف المستحقات بناءً على طلب سحب يقدّمه الممثل من التطبيق، وتُحوَّل إلى حسابه البنكي المسجّل بعد مراجعة الطلب واعتماده من الإدارة.',
  '',
  'ثامنًا — مدة الاتفاقية وإنهاؤها:',
  'للنادي قبول أي طلب انضمام أو رفضه دون إبداء الأسباب، وله إيقاف أي ممثل أو تعديل قيم العمولات والبدل وشروط دورات الأداء أو إنهاء البرنامج في أي وقت، مع حفظ حق الممثل في المستحقات الثابتة له قبل التعديل أو الإنهاء.',
  '',
  'تاسعًا — أحكام عامة:',
  'تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية، وتُعد الموافقة الإلكترونية من داخل التطبيق إقرارًا وتوقيعًا ملزمًا.',
].join('\n');

/** The Arabic agreement rendered in English for the English app; the Arabic text stays authoritative. */
export const DEFAULT_AGREEMENT_EN = [
  'Investors Club Affiliates Program Agreement',
  '',
  'Preamble: This agreement is made between the Virtual Community Investment Company, the official operator of the Investors Club (the "Club"), and the applicant (the "Affiliate"). By accepting it electronically inside the app, the Affiliate acknowledges having read and understood it and agrees to be bound by all its terms. This is an English rendering of the agreement; its Arabic text remains the authoritative version.',
  '',
  "First — Scope of the Affiliate's work:",
  "1. The Affiliate's role is limited to introducing the Investors Club membership and its benefits as presented inside the official app, and inviting interested individuals to register through his personal referral link or referral code.",
  '2. The Affiliate may not present any benefits, prices or promises not stated in the app, nor provide investment advice, guarantees or projections of returns of any kind.',
  '',
  'Second — Status of the Affiliate:',
  "1. The Affiliate is an independent marketer — not an employee, agent or partner of the Club — and holds no authority to contract or make commitments in the Club's name.",
  "2. The Affiliate may use the Club's name or logo only within the introduction described above; creating accounts, pages or websites that suggest an official affiliation with the Club is prohibited.",
  '',
  'Third — Limits of liability:',
  "1. The Club bears no legal or financial liability of any kind for any act of the Affiliate, any misuse of the Club's name or brand, or any commitment the Affiliate makes to third parties.",
  '2. The Affiliate alone bears full responsibility for his marketing methods and channels and for their compliance with the laws of the Kingdom of Saudi Arabia, and shall indemnify the Club for any damage arising from his breach of this agreement.',
  '',
  "Fourth — The Club's obligations:",
  "The Club's obligations are limited to providing the membership and its benefits to registered members, operating the affiliates program, and calculating the commissions due under this agreement.",
  '',
  'Fifth — Commissions:',
  '1. An Affiliate who does not hold the annual membership earns a commission of {commission} for every member who registered through his referral code and actually paid the annual membership fee.',
  '2. An Affiliate who holds the annual membership earns a commission of {commissionMember} for every paying member on the same terms.',
  "3. The commission tier follows the Affiliate's membership status on the date the referred member pays, and the commission for that member is fixed once calculated. No commission is due for registration alone without payment.",
  "4. Commissions are calculated according to the Club's records and electronic systems, which are the sole authoritative reference.",
  '',
  'Sixth — Transportation and incidental-expenses allowance:',
  '1. The Affiliate receives {bonus} as a transportation and incidental-expenses allowance, as additional support from the Club management, upon bringing in {bonusTarget} paying members within a performance cycle of {bonusDays} days, whether or not he holds the annual membership.',
  '2. The first performance cycle starts on the date the Affiliate is approved, and the app shows a counter of the days remaining and the paying members within it. When a cycle ends, the system files a renewal request with the management, and the cycle is renewed with the duration, target and amount the management sets.',
  "3. The allowance is due once per cycle; it is added to the Affiliate's balance and paid out under the payout provisions.",
  '',
  'Seventh — Payouts:',
  "1. The minimum for paying out and transferring dues is {minPayout} paying members brought in through the Affiliate's referral code, whether or not he holds the annual membership.",
  "2. Earned commissions carry forward and remain held in the Affiliate's balance until the payout minimum is reached.",
  '3. Dues are paid upon a withdrawal request submitted by the Affiliate from the app and transferred to his registered bank account after the management reviews and approves the request.',
  '',
  'Eighth — Term and termination:',
  "The Club may accept or refuse any application without stating reasons, and may suspend any affiliate, change the commission and allowance amounts and the performance-cycle terms, or end the program at any time, while preserving the Affiliate's right to the dues fixed before the change or termination.",
  '',
  'Ninth — General provisions:',
  'This agreement is governed by the laws of the Kingdom of Saudi Arabia, and electronic acceptance inside the app constitutes a binding acknowledgment and signature.',
].join('\n');

export const DEFAULT_AFFILIATE_CONFIG: AffiliateConfig = {
  commission: 250,
  commissionMember: 350,
  cycleDays: 30,
  cycleTarget: 10,
  cycleBonus: 1500,
  minPayoutPaid: 5,
  agreementText: DEFAULT_AGREEMENT,
  agreementTextEn: DEFAULT_AGREEMENT_EN,
  // M186: the owner's terms (2026-11-02) in the club's voice, every amount dashboard-driven.
  introText: [
    'انضم إلى برنامج ممثلي نادي المستثمرين، وكن سفيرًا لمجتمع أعمال يجمع روّاد الأعمال والمستثمرين. عرّف بعضوية النادي ومزاياها في محيط علاقاتك، وادعُ المهتمين إلى التسجيل عبر رابطك الخاص.',
    '• عمولة {commission} عن كل عضو دافع، ترتفع إلى {commissionMember} إن كنت مشتركًا في العضوية السنوية.',
    '• بدل مواصلات ومصروفات نثرية قدره {bonus} عند استقطاب {bonusTarget} أعضاء دافعين خلال {bonusDays} يومًا، مشتركًا كنت أو غير مشترك.',
    '• يُتاح صرف المستحقات بعد اكتمال {minPayout} أعضاء دافعين، وتُرحَّل العمولات محفوظةً في رصيدك إلى حين بلوغ هذا الحد.',
    'يخضع الانضمام لموافقة إدارة النادي بعد قبول اتفاقية البرنامج.',
  ].join('\n'),
  introTextEn: [
    'Join the Investors Club Affiliates Program and become an ambassador for a business community that brings entrepreneurs and investors together. Introduce the Club membership and its benefits within your network, and invite interested contacts to register through your personal link.',
    '• {commission} for every paying member, rising to {commissionMember} when you hold the annual membership yourself.',
    '• A {bonus} transportation and incidental-expenses allowance when you bring in {bonusTarget} paying members within {bonusDays} days, member or not.',
    '• Payouts open once {minPayout} referred members have paid; earned commissions carry forward in your balance until then.',
    'Participation is subject to the Club management’s approval after you accept the program agreement.',
  ].join('\n'),
  shareText: [
    'أدعوك للانضمام إلى نادي المستثمرين Investors Club — مجتمع أعمال وشراكات وخدمات لروّاد الأعمال والمستثمرين.',
    'سجّل عبر رابطي الشخصي: {link}',
    'وعند التسجيل أدخل رمز الإحالة {code} في خانة «كود الدعوة».',
  ].join('\n'),
  heardOptions: DEFAULT_HEARD_OPTIONS,
  heardOptionsEn: DEFAULT_HEARD_OPTIONS_EN,
  // M194 (owner, 2026-11-04: «يفكره يوميا انه لسه ما سجل يا صديقي»).
  reminderEnabled: true,
  reminderTitle: 'تذكير من مستشارك',
  reminderBody: 'ما سجّلت أي عضو دافع حتى الآن يا صديقي. شارك رابطك الخاص اليوم، وعمولتك {commission} عن كل عضو يسدّد عضويته.',
  reminderTitleEn: 'A reminder from your advisor',
  reminderBodyEn: 'No paying member has joined through you yet, my friend. Share your personal link today and earn {commission} for every member who pays.',
};

/**
 * M186: bumped whenever the default texts change for a new set of terms — stored texts saved under an
 * older version give way to the new defaults once (the owner's terms must reach the app and the mail).
 */
const TEXTS_VERSION = 3;

/** What the affiliate sees about each referral (no contact details — only the hub holds those). */
export type AffiliateReferral = { name: string; at: string; paid: boolean; paidAt: string | null; amount: number | null };

/** M186: the counter the app and the dashboard show for the current cycle. */
export type AffiliateCycleView = {
  n: number;
  startAt: string;
  endAt: string;
  daysLeft: number;
  target: number;
  paid: number;
  bonus: number;
  achieved: boolean;
  bonusAt: string | null;
  /** running = the counter is live; renewal = it ran out and waits for the dashboard. */
  state: 'running' | 'renewal';
};

export type AffiliateBalance = {
  /** The rate that applies to the next paying referral (follows the affiliate's membership now). */
  commission: number;
  commissionBase: number;
  commissionMember: number;
  member: boolean;
  /** Allowances already added to the balance. */
  bonuses: number;
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

/** M194: the slice of PushService the daily reminder needs (absent = no reminder, e.g. AUTO_PUSH=0). */
export type AffiliatePush = { sendTo(contactId: number, messageOf: (lang: AppLang) => { title: string; body: string; data?: Record<string, string> }): Promise<{ sent: number }> };

type Deps = {
  kv: KV;
  invites: InvitesService;
  notifier: Notifier;
  log: FastifyBaseLogger;
  publicUrl: string;
  /** M202: optional so a server without WhatsApp, and the tests, simply skip the message. */
  whatsapp?: Pick<WhatsappService, 'sendAffiliateLink'>;
  push?: AffiliatePush;
  /** Accounts that muted the advisor's daily push (M87b) hear no reminder either. */
  muted?: () => Promise<Set<number>>;
};

export class AffiliateService {
  private chain: Promise<unknown> = Promise.resolve();

  private backfillQueued = false;

  constructor(private readonly deps: Deps) {
    // M198: a short code typed as «كود الدعوة» becomes the membership number before the hub call.
    deps.invites.setAliasResolver(async (raw) => (await this.findByShortCode(raw))?.code ?? null);
  }

  /**
   * The records, every one with a short code: those saved before M198 and the «FAR-27» aliases of M198
   * get a new one here, in the order they applied (deterministic, so the alias is the same on every
   * load), and the next write keeps it. The earlier alias moves to `oldCodes` and keeps working.
   */
  private async loadRecords(): Promise<AffiliateRecord[]> {
    const affiliates = (await this.deps.kv.get<{ affiliates: AffiliateRecord[] }>(AFFILIATES_KEY))?.affiliates ?? [];
    const missing = affiliates.filter((record) => isLegacyCode(record.shortCode) && !record.oldCodes?.length);
    if (missing.length) {
      const taken = AffiliateService.takenCodes(affiliates);
      for (const record of [...missing].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))) {
        if (record.shortCode) record.oldCodes = [record.shortCode];
        record.shortCode = newShortCode(record.name, taken);
        taken.push(record.shortCode);
      }
      if (!this.backfillQueued) {
        this.backfillQueued = true;
        void this.mutate(() => undefined).catch((error) => this.deps.log.warn({ err: error }, 'affiliate: short-code backfill failed'));
      }
    }
    return affiliates;
  }

  /** Every alias in use or ever shared, so a new one never lands on a link that is already out there. */
  private static takenCodes(affiliates: AffiliateRecord[]): string[] {
    return affiliates.flatMap((record) => [...(record.shortCode ? [record.shortCode] : []), ...(record.oldCodes ?? [])]);
  }

  /** The code the member shares and sees: the short alias, or the membership number before M198. */
  static codeOf(record: Pick<AffiliateRecord, 'code' | 'shortCode'>): string {
    return record.shortCode ?? record.code;
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
    const stored = await this.deps.kv.get<Partial<AffiliateConfig> & { textsVersion?: number }>(AFFILIATE_CONFIG_KEY);
    // Texts saved under older terms give way to the current defaults (M186); the numbers always stand.
    const texts = stored?.textsVersion === TEXTS_VERSION ? stored : undefined;
    const options = (stored?.heardOptions ?? []).map((option) => option.trim()).filter(Boolean);
    // M195: the English column rides along line by line; the defaults' English only with the default Arabic.
    const optionsEn = (stored?.heardOptionsEn ?? []).map((option) => option.trim());
    const count = (value: unknown, fallback: number, min = 0) => (typeof value === 'number' && value >= min ? Math.round(value) : fallback);
    return {
      commission: count(stored?.commission, DEFAULT_AFFILIATE_CONFIG.commission, 1),
      commissionMember: count(stored?.commissionMember, DEFAULT_AFFILIATE_CONFIG.commissionMember, 1),
      cycleDays: count(stored?.cycleDays, DEFAULT_AFFILIATE_CONFIG.cycleDays, 1),
      cycleTarget: count(stored?.cycleTarget, DEFAULT_AFFILIATE_CONFIG.cycleTarget, 1),
      cycleBonus: count(stored?.cycleBonus, DEFAULT_AFFILIATE_CONFIG.cycleBonus),
      minPayoutPaid: count(stored?.minPayoutPaid, DEFAULT_AFFILIATE_CONFIG.minPayoutPaid),
      agreementText: texts?.agreementText?.trim() || DEFAULT_AFFILIATE_CONFIG.agreementText,
      agreementTextEn: texts?.agreementTextEn?.trim() || DEFAULT_AFFILIATE_CONFIG.agreementTextEn,
      introText: texts?.introText?.trim() || DEFAULT_AFFILIATE_CONFIG.introText,
      introTextEn: texts?.introTextEn?.trim() || DEFAULT_AFFILIATE_CONFIG.introTextEn,
      shareText: stored?.shareText?.trim() || DEFAULT_AFFILIATE_CONFIG.shareText,
      heardOptions: options.length ? options : DEFAULT_AFFILIATE_CONFIG.heardOptions,
      heardOptionsEn: optionsEn.some(Boolean) ? optionsEn : options.length ? [] : DEFAULT_AFFILIATE_CONFIG.heardOptionsEn,
      reminderEnabled: typeof stored?.reminderEnabled === 'boolean' ? stored.reminderEnabled : DEFAULT_AFFILIATE_CONFIG.reminderEnabled,
      reminderTitle: stored?.reminderTitle?.trim() || DEFAULT_AFFILIATE_CONFIG.reminderTitle,
      reminderBody: stored?.reminderBody?.trim() || DEFAULT_AFFILIATE_CONFIG.reminderBody,
      reminderTitleEn: stored?.reminderTitleEn?.trim() || DEFAULT_AFFILIATE_CONFIG.reminderTitleEn,
      reminderBodyEn: stored?.reminderBodyEn?.trim() || DEFAULT_AFFILIATE_CONFIG.reminderBodyEn,
    };
  }

  async saveConfig(input: Partial<AffiliateConfig>): Promise<AffiliateConfig> {
    const current = await this.config();
    const next: AffiliateConfig = {
      commission: input.commission !== undefined ? Math.round(input.commission) : current.commission,
      commissionMember: input.commissionMember !== undefined ? Math.round(input.commissionMember) : current.commissionMember,
      cycleDays: input.cycleDays !== undefined ? Math.max(1, Math.round(input.cycleDays)) : current.cycleDays,
      cycleTarget: input.cycleTarget !== undefined ? Math.max(1, Math.round(input.cycleTarget)) : current.cycleTarget,
      cycleBonus: input.cycleBonus !== undefined ? Math.max(0, Math.round(input.cycleBonus)) : current.cycleBonus,
      minPayoutPaid: input.minPayoutPaid !== undefined ? Math.max(0, Math.round(input.minPayoutPaid)) : current.minPayoutPaid,
      agreementText: (input.agreementText ?? current.agreementText).trim() || DEFAULT_AFFILIATE_CONFIG.agreementText,
      agreementTextEn: (input.agreementTextEn ?? current.agreementTextEn).trim() || DEFAULT_AFFILIATE_CONFIG.agreementTextEn,
      introText: (input.introText ?? current.introText).trim() || DEFAULT_AFFILIATE_CONFIG.introText,
      introTextEn: (input.introTextEn ?? current.introTextEn).trim() || DEFAULT_AFFILIATE_CONFIG.introTextEn,
      shareText: (input.shareText ?? current.shareText).trim() || DEFAULT_AFFILIATE_CONFIG.shareText,
      heardOptions: (input.heardOptions ?? current.heardOptions).map((option) => option.trim()).filter(Boolean),
      heardOptionsEn: (input.heardOptionsEn ?? current.heardOptionsEn).map((option) => option.trim()),
      reminderEnabled: input.reminderEnabled ?? current.reminderEnabled,
      reminderTitle: (input.reminderTitle ?? current.reminderTitle).trim() || DEFAULT_AFFILIATE_CONFIG.reminderTitle,
      reminderBody: (input.reminderBody ?? current.reminderBody).trim() || DEFAULT_AFFILIATE_CONFIG.reminderBody,
      reminderTitleEn: (input.reminderTitleEn ?? current.reminderTitleEn).trim() || DEFAULT_AFFILIATE_CONFIG.reminderTitleEn,
      reminderBodyEn: (input.reminderBodyEn ?? current.reminderBodyEn).trim() || DEFAULT_AFFILIATE_CONFIG.reminderBodyEn,
    };
    if (!next.heardOptions.length) next.heardOptions = DEFAULT_AFFILIATE_CONFIG.heardOptions;
    await this.deps.kv.set(AFFILIATE_CONFIG_KEY, { ...next, textsVersion: TEXTS_VERSION });
    return next;
  }

  /** M195: the source options as {value: the stored Arabic, label: the reader's language}. */
  static heardChoices(config: AffiliateConfig, lang: 'ar' | 'en'): { value: string; label: string }[] {
    return config.heardOptions.map((option, index) => ({ value: option, label: (lang === 'en' && config.heardOptionsEn[index]?.trim()) || option }));
  }

  /**
   * M195: the city of residence as the record stores it (the Arabic name). The app sends a list key, or
   * 'other' plus a typed name; an older bundle's bare name of a listed city is mapped too, and any other
   * free text must at least read as a name (letters only).
   */
  static resolveCity(value: string, other: string, en: boolean): string {
    const listed = cityByKey(value);
    if (listed && listed.key !== OTHER_CITY) return listed.ar;
    const known = listed ? null : cityByKey(cityKeyOf(value));
    if (known && known.key !== OTHER_CITY) return known.ar;
    const typed = (listed ? other : value).replace(/\s+/g, ' ').trim();
    if (!CITY_NAME.test(typed)) {
      throw new RequestError('city', en ? 'Pick your city from the list, or type its name (letters only)' : 'اختر مدينتك من القائمة أو اكتب اسمها بالحروف فقط', 400);
    }
    return typed;
  }

  /** The amount in words the texts carry («250 ريال سعودي», «1,500 ريال سعودي»). */
  static commissionLabel(commission: number): string {
    return `${commission.toLocaleString('en-US')} ريال سعودي`;
  }

  /** The same amount for the English app («SAR 250»). */
  static commissionLabelEn(commission: number): string {
    return `SAR ${commission.toLocaleString('en-US')}`;
  }

  /** Every placeholder of the intro and the agreement, in the reader's language. */
  static fillTerms(text: string, config: AffiliateConfig, lang: 'ar' | 'en'): string {
    const money = lang === 'en' ? AffiliateService.commissionLabelEn : AffiliateService.commissionLabel;
    return text
      .replaceAll('{commissionMember}', money(config.commissionMember))
      .replaceAll('{commission}', money(config.commission))
      .replaceAll('{bonusTarget}', String(config.cycleTarget))
      .replaceAll('{bonusDays}', String(config.cycleDays))
      .replaceAll('{bonus}', money(config.cycleBonus))
      .replaceAll('{minPayout}', String(config.minPayoutPaid));
  }

  /** M186: a member at `at` when the last-seen membership window covers it (an annual membership ends a year after it starts). */
  private static memberAt(record: AffiliateRecord, at: string): boolean {
    const seen = record.membership;
    if (!seen?.active && !seen?.endDate) return false;
    if (!seen.endDate) return seen.active;
    const end = Date.parse(seen.endDate);
    const when = Date.parse(at);
    return when <= end && when >= end - 366 * DAY_MS;
  }

  private static newCycle(n: number, days: number, target: number, bonus: number, now: Date): AffiliateCycle {
    return {
      n,
      startAt: now.toISOString(),
      endAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
      target,
      bonus,
      bonusAt: null,
      closedAt: null,
      paid: null,
    };
  }

  /** The affiliate's paid referrals straight from the invite records (the hub-verified channel). */
  private async paidInvites(contactId: number): Promise<Array<{ id: string; name: string; paidAt: string }>> {
    return (await this.deps.invites.list())
      .filter((invite) => invite.inviterId === contactId && invite.activatedAt)
      .map((invite) => ({ id: invite.id, name: invite.inviteeName, paidAt: invite.activatedAt as string }));
  }

  private static countIn(paid: Array<{ paidAt: string }>, cycle: AffiliateCycle): number {
    return paid.filter((entry) => entry.paidAt >= cycle.startAt && entry.paidAt <= cycle.endAt).length;
  }

  /**
   * M186: brings one affiliate up to date — stamps new paid referrals at the tier of that moment,
   * adds the cycle allowance when the target is met inside the window, and files the renewal request
   * when the counter runs out. Called on every app visit (with the hub's fresh membership) and by the
   * scheduled sweep; idempotent. Until a membership was seen once, stamping waits for the visit.
   */
  async sync(contactId: number, now = new Date(), membership?: { active: boolean; endDate: string | null }): Promise<void> {
    const [config, paid] = await Promise.all([this.config(), this.paidInvites(contactId)]);
    const events = await this.mutate((affiliates) => {
      const record = affiliates.find((entry) => entry.contactId === contactId);
      const out: { bonus?: AffiliateCycle; ended?: AffiliateCycle; record?: AffiliateRecord } = {};
      if (!record || record.status !== 'approved') return out;
      if (membership) record.membership = { ...membership, seenAt: now.toISOString() };
      if (!record.earnings) {
        // The first sync after M186: referrals paid before it keep the original 250 (the owner's plan).
        record.earnings = paid.map((entry) => ({ inviteId: entry.id, name: entry.name, paidAt: entry.paidAt, amount: config.commission, member: false }));
      } else if (record.membership) {
        const stamped = new Set(record.earnings.map((entry) => entry.inviteId));
        for (const entry of paid) {
          if (stamped.has(entry.id)) continue;
          const member = AffiliateService.memberAt(record, entry.paidAt);
          record.earnings.push({ inviteId: entry.id, name: entry.name, paidAt: entry.paidAt, amount: member ? config.commissionMember : config.commission, member });
        }
      }
      if (!record.cycles?.length) {
        record.cycles = [AffiliateService.newCycle(1, config.cycleDays, config.cycleTarget, config.cycleBonus, now)];
      }
      const cycle = record.cycles[record.cycles.length - 1];
      if (!cycle || cycle.closedAt) return out;
      const inWindow = AffiliateService.countIn(paid, cycle);
      if (!cycle.bonusAt && cycle.bonus > 0 && inWindow >= cycle.target) {
        cycle.bonusAt = now.toISOString();
        out.bonus = { ...cycle };
      }
      if (now.toISOString() > cycle.endAt) {
        cycle.closedAt = now.toISOString();
        cycle.paid = inWindow;
        record.renewalRequestedAt = now.toISOString();
        out.ended = { ...cycle };
      }
      out.record = { ...record };
      return out;
    });
    if (events.record && events.bonus) this.deps.notifier.affiliateBonus(events.record, events.bonus);
    if (events.record && events.ended) this.deps.notifier.affiliateCycleEnded(events.record, events.ended);
  }

  /** The scheduled sweep: every approved affiliate, so a counter that runs out files its request on time. */
  async sweep(now = new Date()): Promise<void> {
    const approved = (await this.loadRecords()).filter((record) => record.status === 'approved');
    for (const record of approved) {
      try {
        await this.sync(record.contactId, now);
      } catch (error) {
        this.deps.log.error({ err: error, contactId: record.contactId }, 'affiliate sweep failed');
      }
    }
  }

  /**
   * M194 (owner, 2026-11-04): once a day at 19:00 Riyadh the advisor reminds every APPROVED affiliate
   * who has no paying member yet («لسه ما سجّلت يا صديقي»), in the language his app runs in; tapping
   * opens the affiliate panel. Dashboard switch + texts; muted advisor pushes stay muted. Safe to call
   * any time — it acts once per Riyadh day, inside the hour.
   */
  async remind(now = Date.now()): Promise<number> {
    const push = this.deps.push;
    if (!push || riyadhHour(now) !== REMINDER_HOUR) return 0;
    const today = riyadhDay(now);
    if ((await this.deps.kv.get<{ day: string }>(REMINDER_KEY))?.day === today) return 0;
    await this.deps.kv.set(REMINDER_KEY, { day: today });
    const config = await this.config();
    if (!config.reminderEnabled) return 0;
    const [records, muted] = await Promise.all([this.loadRecords(), this.deps.muted ? this.deps.muted() : Promise.resolve(new Set<number>())]);
    let reminded = 0;
    for (const record of records) {
      if (record.status !== 'approved' || muted.has(record.contactId)) continue;
      try {
        if ((await this.paidInvites(record.contactId)).length > 0) continue;
        const outcome = await push.sendTo(record.contactId, (lang) => ({
          title: lang === 'en' ? config.reminderTitleEn : config.reminderTitle,
          body: AffiliateService.fillTerms(lang === 'en' ? config.reminderBodyEn : config.reminderBody, config, lang),
          data: { screen: '/affiliate', type: 'affiliate-reminder' },
        }));
        if (outcome.sent > 0) reminded += 1;
      } catch (error) {
        this.deps.log.error({ err: error, contactId: record.contactId }, 'affiliate reminder failed');
      }
    }
    this.deps.log.info({ reminded, day: today }, 'affiliate daily reminder');
    return reminded;
  }

  /** The dashboard renews (or restarts early) the counter with a new duration, target and allowance. */
  async renewCycle(contactId: number, input: { days: number; target: number; bonus: number }, now = new Date()): Promise<AffiliateRecord | null> {
    const paid = await this.paidInvites(contactId);
    const result = await this.mutate((affiliates) => {
      const record = affiliates.find((entry) => entry.contactId === contactId);
      if (!record) return null;
      if (record.status !== 'approved') throw new RequestError('not_affiliate', 'الممثل غير معتمد حاليًا', 400);
      const cycles = (record.cycles ??= []);
      const current = cycles[cycles.length - 1];
      if (current && !current.closedAt) {
        current.closedAt = now.toISOString();
        current.paid = AffiliateService.countIn(paid, current);
      }
      const next = AffiliateService.newCycle(cycles.length + 1, input.days, input.target, input.bonus, now);
      cycles.push(next);
      record.renewalRequestedAt = null;
      return { record: { ...record }, cycle: next };
    });
    if (result) this.deps.notifier.affiliateCycleRenewed(result.record, result.cycle);
    return result?.record ?? null;
  }

  /** The current counter as the app and the dashboard show it. */
  async cycleView(contactId: number, now = new Date()): Promise<AffiliateCycleView | null> {
    const record = await this.find(contactId);
    const cycle = record?.cycles?.[record.cycles.length - 1];
    if (!record || !cycle) return null;
    const paid = cycle.closedAt && cycle.paid !== null ? cycle.paid : AffiliateService.countIn(await this.paidInvites(contactId), cycle);
    return {
      n: cycle.n,
      startAt: cycle.startAt,
      endAt: cycle.endAt,
      daysLeft: cycle.closedAt ? 0 : Math.max(0, Math.ceil((Date.parse(cycle.endAt) - now.getTime()) / DAY_MS)),
      target: cycle.target,
      paid,
      bonus: cycle.bonus,
      achieved: Boolean(cycle.bonusAt),
      bonusAt: cycle.bonusAt,
      state: cycle.closedAt ? 'renewal' : 'running',
    };
  }

  referralLink(code: string): string {
    const base = this.deps.publicUrl.replace(/\/+$/, '');
    return base ? `${base}/r/${encodeURIComponent(code.toLowerCase())}` : '';
  }

  async find(contactId: number): Promise<AffiliateRecord | null> {
    return (await this.loadRecords()).find((record) => record.contactId === contactId) ?? null;
  }

  /** By the membership number OR any alias he ever held — every form of the link keeps working. */
  async findByCode(code: string): Promise<AffiliateRecord | null> {
    const wanted = code.trim().toUpperCase();
    return (await this.loadRecords()).find((record) => record.code.toUpperCase() === wanted) ?? (await this.findByShortCode(code));
  }

  /**
   * By an alias, current or old. The exact text wins; otherwise look-alikes are forgiven («far 2», «RlN2»,
   * «f0x3») but only when they point at one person: a commission never lands on a guess.
   */
  async findByShortCode(raw: string): Promise<AffiliateRecord | null> {
    const key = codeKey(raw);
    if (!key) return null;
    const records = await this.loadRecords();
    const exact = normalizeShortCode(raw);
    const holds = (record: AffiliateRecord, test: (code: string) => boolean): boolean => [record.shortCode ?? '', ...(record.oldCodes ?? [])].some((code) => code && test(code));
    const found = exact ? records.find((record) => holds(record, (code) => code === exact)) : undefined;
    if (found) return found;
    const loose = records.filter((record) => holds(record, (code) => codeKey(code) === key));
    return loose.length === 1 ? (loose[0] ?? null) : null;
  }

  /**
   * M202: the dashboard picks an alias by hand when the generated one reads badly. The one it replaces
   * stays in `oldCodes`, so anything already shared keeps working.
   */
  async setShortCode(contactId: number, raw: string): Promise<AffiliateRecord | null> {
    const code = normalizeShortCode(raw);
    if (!code || code.includes('-')) {
      throw new RequestError('short_code', 'الرمز من 3 إلى 5 حروف لاتينية، ويمكن أن ينتهي برقم واحد من 2 إلى 9', 400);
    }
    return this.mutate((affiliates) => {
      const existing = affiliates.find((entry) => entry.contactId === contactId);
      if (!existing) return null;
      const others = AffiliateService.takenCodes(affiliates.filter((entry) => entry !== existing));
      if (others.some((taken) => codeKey(taken) === codeKey(code))) {
        throw new RequestError('short_code_taken', 'هذا الرمز مستخدم لممثل آخر، أو يشبهه في الكتابة', 400);
      }
      if (existing.shortCode === code) return { ...existing };
      existing.oldCodes = [...(existing.oldCodes ?? []), ...(existing.shortCode ? [existing.shortCode] : [])].filter((old) => old !== code);
      existing.shortCode = code;
      return { ...existing };
    });
  }

  /** M202: his code and link on WhatsApp (club_affiliate_link). The ref stops a second send of the same code. */
  private async sendLink(record: AffiliateRecord): Promise<WaResult> {
    if (!this.deps.whatsapp) return { channel: 'none', error: 'whatsapp_disabled' };
    const code = AffiliateService.codeOf(record);
    return this.deps.whatsapp.sendAffiliateLink({
      phone: record.phone,
      lang: record.lang ?? 'ar',
      name: record.name,
      code,
      link: this.referralLink(code),
      ref: `affiliate-link:${record.contactId}:${code}`,
    });
  }

  /** M202, dashboard only: sends the approved affiliates their code and link: one of them, or all. */
  async sendLinks(contactId?: number): Promise<{ contactId: number; name: string; code: string; channel: string; error: string | null }[]> {
    const approved = (await this.loadRecords()).filter((record) => record.status === 'approved' && (contactId === undefined || record.contactId === contactId));
    const results: { contactId: number; name: string; code: string; channel: string; error: string | null }[] = [];
    for (const record of approved) {
      const sent = await this.sendLink(record);
      results.push({ contactId: record.contactId, name: record.name, code: AffiliateService.codeOf(record), channel: sent.channel, error: sent.error ?? null });
    }
    return results;
  }

  /**
   * The application (or a re-application after a rejection, or an update while the agreement is
   * still unaccepted). The agreement goes out by e-mail at once; approval stays the dashboard's.
   */
  async apply(
    member: { contactId: number; name: string; email: string; phone: string; code: string },
    form: { entityType: 'individual' | 'company'; bankName: string; accountName: string; iban: string; city: string; cityOther?: string; address: string; heardFrom: string; heardFromNote?: string },
    now = new Date(),
    lang: AppLang = 'ar',
  ): Promise<AffiliateRecord> {
    const config = await this.config();
    const en = lang === 'en';
    if (!config.heardOptions.includes(form.heardFrom)) {
      throw new RequestError('heard_from', en ? 'Pick how you heard about the Investors Club from the list' : 'اختر كيف عرفت عن نادي المستثمرين من القائمة', 400);
    }
    const city = AffiliateService.resolveCity(form.city, form.cityOther ?? '', en);
    // M195: an address, not a person's name (owner: a member wrote his own name there) — 10+ characters, two words.
    const address = form.address.replace(/\s+/g, ' ').trim();
    const sameAsName = [member.name, form.accountName].some((name) => foldName(name) === foldName(address));
    if (address.length < 10 || address.split(' ').length < 2 || sameAsName || looksLikePersonName(address)) {
      throw new RequestError('address', en ? 'Write a real address: district, street and building number' : 'اكتب عنوانًا فعليًا: الحي والشارع ورقم المبنى', 400);
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
        // M198: a re-application keeps the aliases the member may already have shared.
        shortCode: existing?.shortCode ?? newShortCode(member.name, AffiliateService.takenCodes(affiliates)),
        ...(existing?.oldCodes?.length ? { oldCodes: existing.oldCodes } : {}),
        status: 'agreement',
        entityType: form.entityType,
        bankName: form.bankName,
        accountName: form.accountName,
        iban: form.iban,
        city,
        address,
        heardFrom: form.heardFrom,
        // M195 (owner): the «Tell us the source» note is gone — the option stands alone.
        heardFromNote: '',
        lang,
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
    // M195: the agreement mail in the applicant's language (the Arabic text stays the authoritative one).
    this.deps.notifier.affiliateAgreement(
      record,
      AffiliateService.fillTerms(en ? config.agreementTextEn : config.agreementText, config, en ? 'en' : 'ar'),
      en ? AffiliateService.commissionLabelEn(config.commission) : AffiliateService.commissionLabel(config.commission),
    );
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
    const config = await this.config();
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
      if (status === 'approved') {
        // M186: a fresh approval stamps every paid referral at its own tier, and the first counter starts now.
        existing.earnings ??= [];
        if (!existing.cycles?.length) existing.cycles = [AffiliateService.newCycle(1, config.cycleDays, config.cycleTarget, config.cycleBonus, now)];
        existing.renewalRequestedAt ??= null;
      }
      return { ...existing };
    });
    if (record) this.deps.notifier.affiliateDecided(record, this.referralLink(AffiliateService.codeOf(record)));
    // M202: a new affiliate gets his code and link on WhatsApp too. It never holds up the decision.
    if (record?.status === 'approved') void this.sendLink(record);
    return record;
  }

  /** The affiliate's referrals: every hub-verified registration with his code, paid = membership activated. */
  async referrals(contactId: number): Promise<AffiliateReferral[]> {
    const [invites, record] = await Promise.all([this.deps.invites.list(), this.find(contactId)]);
    const amounts = new Map((record?.earnings ?? []).map((entry) => [entry.inviteId, entry.amount]));
    return invites
      .filter((invite) => invite.inviterId === contactId)
      .map((invite) => ({
        name: invite.inviteeName,
        at: invite.createdAt,
        paid: Boolean(invite.activatedAt),
        paidAt: invite.activatedAt,
        amount: amounts.get(invite.id) ?? null,
      }));
  }

  async balance(contactId: number): Promise<AffiliateBalance> {
    const [config, record, invites, payouts] = await Promise.all([this.config(), this.find(contactId), this.deps.invites.list(), this.loadPayouts()]);
    const mine = invites.filter((invite) => invite.inviterId === contactId);
    const paidList = mine.filter((invite) => invite.activatedAt);
    const paid = paidList.length;
    const withdrawn = payouts
      .filter((payout) => payout.contactId === contactId && payout.status !== 'rejected')
      .reduce((sum, payout) => sum + payout.amount, 0);
    const member = record ? AffiliateService.memberAt(record, new Date().toISOString()) : false;
    const commission = member ? config.commissionMember : config.commission;
    // Stamped referrals keep their fixed amount; any not stamped yet count at today's tier until the next sync.
    const stamped = new Map((record?.earnings ?? []).map((entry) => [entry.inviteId, entry.amount]));
    const commissions = paidList.reduce((sum, entry) => sum + (stamped.get(entry.id) ?? commission), 0);
    const bonuses = (record?.cycles ?? []).filter((cycle) => cycle.bonusAt).reduce((sum, cycle) => sum + cycle.bonus, 0);
    const earned = commissions + bonuses;
    return {
      commission,
      commissionBase: config.commission,
      commissionMember: config.commissionMember,
      member,
      bonuses,
      minPaid: config.minPayoutPaid,
      referrals: mine.length,
      paid,
      unpaid: mine.length - paid,
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
      if (!affiliate || affiliate.status !== 'approved') throw new RequestError('not_affiliate', 'هذه الخدمة لممثلي نادي المستثمرين المعتمدين', 403);
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
