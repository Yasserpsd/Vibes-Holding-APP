import { lastRiyadhDays, riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M255 (owner, 2026-11-19: «كتير من الناس بتواجه مشكلة أثناء التسجيل… مش بيكون واضح إيه المشكلة»): where sign-ups,
 * sign-ins and password resets stop — counted, so the dashboard shows the real causes instead of a guess.
 *
 * Counts only: the step, the refusal code, the refused field, the platform, per Riyadh day. Never an address, a
 * number, a name or any part of what was typed. One small record per day; nothing here identifies a person.
 */
export type AuthStep = 'register' | 'login' | 'reset';
export type RefusalReason = { code: string; field: string; label: string; count: number; ios: number; android: number };
export type RefusalStep = { step: AuthStep; label: string; /** M257: how many times the form was opened (apps from 1.3.5 on tell). */ opened: number; passed: number; refused: number; reasons: RefusalReason[] };
export type RefusalReport = { days: number; from: string; to: string; steps: RefusalStep[] };

type StoredDay = { counts: Record<string, number> };

const keyOf = (day: string): string => `auth:refusals:${day}`;
/** The count of requests that passed a step: the denominator of every refusal beside it. */
const PASSED = 'ok';
/** M257: the form was opened — against `ok`, it says how many leave without pressing the button at all. */
const OPENED = 'open';

const STEP_LABELS: Record<AuthStep, string> = { register: 'إنشاء حساب جديد', login: 'تسجيل الدخول', reset: 'استعادة كلمة المرور' };

/** The dashboard is read by the owner and shown to partners: a cause is a plain Arabic sentence, never a code. */
const REASON_LABELS: Record<string, string> = {
  rate: 'محاولات كثيرة في وقت قصير',
  exists: 'الحساب موجود مسبقًا (البريد أو الجوال مسجّل)',
  bad_login: 'البريد أو الجوال أو كلمة المرور غير صحيحة',
  bad_password: 'كلمة المرور غير صحيحة',
  no_account: 'لا يوجد حساب بهذه البيانات',
  phone: 'رقم الجوال غير صحيح',
  email_domain: 'بريد إلكتروني غير مقبول',
  invalid_email: 'بريد إلكتروني غير صحيح',
  phone_proof_required: 'لم يؤكَّد الرقم على واتساب',
  phone_proof_busy: 'تعذّر إرسال رمز واتساب',
  phone_no_whatsapp: 'الرقم غير مفعّل على واتساب',
  invite_code: 'رمز الدعوة غير صحيح',
  invite_unavailable: 'رمز الدعوة غير متاح',
  bad_code: 'رمز التحقق غير صحيح أو منتهٍ',
  pending_expired: 'انتهت مدة التحقق',
  registration_closed: 'التسجيل مغلق',
  admin_only: 'النسخة مفتوحة لحسابات الإدارة فقط',
  hub_unreachable: 'تعذّر الوصول إلى خدمة النادي',
  hub_error: 'خدمة النادي أجابت بخطأ',
  hub_not_supported: 'الخدمة غير متاحة مؤقتًا',
};
const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  email: 'البريد الإلكتروني',
  phone: 'رقم الجوال',
  password: 'كلمة المرور',
  persona: 'فئة العضوية',
  login: 'البريد أو رقم الجوال',
  code: 'رمز التحقق',
  country: 'الدولة',
  jobTitle: 'المسمى الوظيفي',
  inviteCode: 'رمز الدعوة',
  companyName: 'اسم الشركة',
  phoneProof: 'تأكيد الرقم على واتساب',
};

export function reasonLabel(code: string, field: string): string {
  if (code === 'invalid') return field ? `خانة غير صحيحة: ${FIELD_LABELS[field] ?? 'خانة أخرى'}` : 'بيانات غير مكتملة';
  return REASON_LABELS[code] ?? 'سبب آخر';
}

const clean = (value: string, fallback: string): string => (/^[A-Za-z_0-9]{1,40}$/.test(value) ? value : fallback);
const platformOf = (value: string): 'ios' | 'android' | 'other' => (value === 'ios' || value === 'android' ? value : 'other');

export class RefusalCounter {
  /** Writes follow one another, so two refusals in the same instant never lose a count. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly kv: KV,
    private readonly now: () => number = Date.now,
  ) {}

  /** One request refused at a step: the code, the refused field (for `invalid`) and the platform. */
  refused(step: AuthStep, code: string, platform: string, field = ''): void {
    this.add(`${step}|${clean(code, 'other')}|${clean(field, '')}|${platformOf(platform)}`);
  }

  /** One request that passed the step. */
  passed(step: AuthStep, platform: string): void {
    this.add(`${step}|${PASSED}||${platformOf(platform)}`);
  }

  /** M257: the form of a step was opened on a phone. */
  opened(step: AuthStep, platform: string): void {
    this.add(`${step}|${OPENED}||${platformOf(platform)}`);
  }

  /** Resolves once every count noted so far is stored (the tests wait on it; the routes never do). */
  settled(): Promise<void> {
    return this.chain;
  }

  private add(key: string): void {
    const day = riyadhDay(this.now());
    this.chain = this.chain
      .then(async () => {
        const stored = (await this.kv.get<StoredDay>(keyOf(day)))?.counts ?? {};
        await this.kv.set(keyOf(day), { counts: { ...stored, [key]: (stored[key] ?? 0) + 1 } } satisfies StoredDay);
      })
      // A count that could not be stored never fails the request that caused it.
      .catch(() => undefined);
  }

  async report(days = 7): Promise<RefusalReport> {
    await this.chain;
    const span = lastRiyadhDays(Math.min(Math.max(Math.round(days) || 7, 1), 90), this.now());
    const total = new Map<string, number>();
    for (const day of span) {
      const stored = (await this.kv.get<StoredDay>(keyOf(day)))?.counts ?? {};
      for (const [key, count] of Object.entries(stored)) if (typeof count === 'number' && count > 0) total.set(key, (total.get(key) ?? 0) + count);
    }
    const steps = (Object.keys(STEP_LABELS) as AuthStep[]).map((step): RefusalStep => {
      const reasons = new Map<string, RefusalReason>();
      let passed = 0;
      let opened = 0;
      for (const [key, count] of total) {
        const [keyStep, code = '', field = '', platform = 'other'] = key.split('|');
        if (keyStep !== step) continue;
        if (code === PASSED) {
          passed += count;
          continue;
        }
        if (code === OPENED) {
          opened += count;
          continue;
        }
        const id = `${code}|${field}`;
        const reason = reasons.get(id) ?? { code, field, label: reasonLabel(code, field), count: 0, ios: 0, android: 0 };
        reason.count += count;
        if (platform === 'ios') reason.ios += count;
        if (platform === 'android') reason.android += count;
        reasons.set(id, reason);
      }
      const list = [...reasons.values()].sort((a, b) => b.count - a.count);
      return { step, label: STEP_LABELS[step], opened, passed, refused: list.reduce((sum, reason) => sum + reason.count, 0), reasons: list };
    });
    return { days: span.length, from: span[0] ?? '', to: span[span.length - 1] ?? '', steps };
  }
}
