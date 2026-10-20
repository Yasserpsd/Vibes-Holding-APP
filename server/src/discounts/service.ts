import { RequestError } from '../auth/guard.js';
import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M107 «أكواد الخصم»: the owner creates codes from the dashboard (percent, usage cap, validity
 * window) and hands them out. A code is applied inside the unified booking/payment flow; a 100%
 * code confirms without the gateway — that is how «بدون رسوم» attendance works now (owner,
 * 2026-10-20: every activity has a price; whoever should attend without paying gets a 100% code).
 * A use is recorded only when the booking is confirmed (paid, or free by the code).
 */
export const DISCOUNT_CODES_KEY = 'discounts:codes';
export const DISCOUNT_USES_KEY = 'discounts:uses';
const MAX_USES_KEPT = 20_000;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

export type DiscountCode = {
  code: string;
  percent: number;
  maxUses: number;
  /** Riyadh days `2026-10-20`; empty = open on that side. */
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type DiscountCodeInput = Pick<DiscountCode, 'code' | 'percent' | 'maxUses' | 'startsAt' | 'endsAt' | 'enabled' | 'note'>;

export type DiscountUse = {
  code: string;
  contactId: number;
  name: string;
  /** What the code paid for: a service key, or `agenda:<eventId>`. */
  context: string;
  label: string;
  amountBefore: number;
  amountAfter: number;
  paymentId: string | null;
  at: string;
};

export type AdminDiscountCode = DiscountCode & { used: number };

/** What a validated code means for one amount. */
export type AppliedDiscount = { code: string; percent: number; amountBefore: number; amountAfter: number };

export function discountedAmount(amount: number, percent: number): number {
  return Math.max(0, Math.round((amount * (100 - percent)) / 100));
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

type Deps = { kv: KV };

export class DiscountsService {
  private codesChain: Promise<unknown> = Promise.resolve();
  private usesChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async loadCodes(): Promise<DiscountCode[]> {
    return (await this.deps.kv.get<{ codes: DiscountCode[] }>(DISCOUNT_CODES_KEY))?.codes ?? [];
  }

  private mutateCodes<T>(change: (codes: DiscountCode[]) => T): Promise<T> {
    const run = this.codesChain.then(async () => {
      const codes = await this.loadCodes();
      const result = change(codes);
      await this.deps.kv.set(DISCOUNT_CODES_KEY, { codes });
      return result;
    });
    this.codesChain = run.catch(() => undefined);
    return run;
  }

  private async loadUses(): Promise<DiscountUse[]> {
    return (await this.deps.kv.get<{ uses: DiscountUse[] }>(DISCOUNT_USES_KEY))?.uses ?? [];
  }

  private mutateUses<T>(change: (uses: DiscountUse[]) => T): Promise<T> {
    const run = this.usesChain.then(async () => {
      const uses = await this.loadUses();
      const result = change(uses);
      await this.deps.kv.set(DISCOUNT_USES_KEY, { uses: uses.slice(-MAX_USES_KEPT) });
      return result;
    });
    this.usesChain = run.catch(() => undefined);
    return run;
  }

  private static validate(input: DiscountCodeInput): DiscountCodeInput {
    const code = normalizeCode(input.code);
    if (!CODE_PATTERN.test(code)) throw new RequestError('invalid', 'الكود من 3 إلى 30 حرفًا لاتينيًا أو رقمًا');
    if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) throw new RequestError('invalid', 'نسبة الخصم من 1 إلى 100');
    if (!Number.isInteger(input.maxUses) || input.maxUses < 1) throw new RequestError('invalid', 'حدد عدد مرات الاستخدام');
    return { ...input, code, note: input.note.trim().slice(0, 200) };
  }

  async create(input: DiscountCodeInput, now = Date.now()): Promise<DiscountCode> {
    const clean = DiscountsService.validate(input);
    const stamp = new Date(now).toISOString();
    return this.mutateCodes((codes) => {
      if (codes.some((entry) => entry.code === clean.code)) throw new RequestError('duplicate', 'هذا الكود موجود بالفعل');
      const row: DiscountCode = { ...clean, createdAt: stamp, updatedAt: stamp };
      codes.push(row);
      return row;
    });
  }

  async update(code: string, patch: Partial<DiscountCodeInput>, now = Date.now()): Promise<DiscountCode> {
    const key = normalizeCode(code);
    return this.mutateCodes((codes) => {
      const row = codes.find((entry) => entry.code === key);
      if (!row) throw new RequestError('not_found', 'الكود غير موجود', 404);
      const next = DiscountsService.validate({ ...row, ...patch, code: row.code });
      Object.assign(row, next, { updatedAt: new Date(now).toISOString() });
      return row;
    });
  }

  async remove(code: string): Promise<boolean> {
    const key = normalizeCode(code);
    return this.mutateCodes((codes) => {
      const index = codes.findIndex((entry) => entry.code === key);
      if (index < 0) return false;
      codes.splice(index, 1);
      return true;
    });
  }

  async usesOf(code: string): Promise<DiscountUse[]> {
    const key = normalizeCode(code);
    return (await this.loadUses()).filter((entry) => entry.code === key).sort((a, b) => b.at.localeCompare(a.at));
  }

  async adminList(): Promise<AdminDiscountCode[]> {
    const [codes, uses] = await Promise.all([this.loadCodes(), this.loadUses()]);
    const counts = new Map<string, number>();
    for (const use of uses) counts.set(use.code, (counts.get(use.code) ?? 0) + 1);
    return codes
      .map((row) => ({ ...row, used: counts.get(row.code) ?? 0 }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The code when it is usable right now; a clear Arabic error otherwise. */
  async check(raw: string, now = Date.now()): Promise<DiscountCode> {
    const key = normalizeCode(raw);
    if (!key) throw new RequestError('invalid', 'اكتب كود الخصم');
    const row = (await this.loadCodes()).find((entry) => entry.code === key);
    if (!row || !row.enabled) throw new RequestError('not_found', 'كود الخصم غير صحيح', 404);
    const today = riyadhDay(now);
    if (row.startsAt && today < row.startsAt) throw new RequestError('not_started', 'هذا الكود لم يبدأ بعد');
    if (row.endsAt && today > row.endsAt) throw new RequestError('expired', 'انتهت صلاحية هذا الكود');
    const used = (await this.loadUses()).filter((entry) => entry.code === key).length;
    if (used >= row.maxUses) throw new RequestError('exhausted', 'استُنفدت مرات استخدام هذا الكود');
    return row;
  }

  /** Validates the code against an amount; what the member sees before paying. */
  async apply(raw: string, amount: number, now = Date.now()): Promise<AppliedDiscount> {
    const row = await this.check(raw, now);
    return { code: row.code, percent: row.percent, amountBefore: amount, amountAfter: discountedAmount(amount, row.percent) };
  }

  /** Records one confirmed use (the booking was paid, or confirmed free by a 100% code). */
  async recordUse(use: Omit<DiscountUse, 'at'>, now = Date.now()): Promise<void> {
    await this.mutateUses((uses) => {
      // A payment settles exactly once, but the webhook may repeat: the same payment never counts twice.
      if (use.paymentId && uses.some((entry) => entry.paymentId === use.paymentId)) return;
      uses.push({ ...use, at: new Date(now).toISOString() });
    });
  }
}
