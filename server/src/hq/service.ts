import { randomBytes, randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import QRCode from 'qrcode';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { getHqContent, type HqContent } from '../content/hq.js';
import { hqPhotos } from '../content/images.js';
import type { AppLang } from '../lang.js';
import type { Notifier, VisitLike } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
import { fromVisit } from '../requests/model.js';
import type { MemberNotices } from '../requests/notices.js';
import type { KV } from '../store.js';

/**
 * HQ visits: a paid member books a date, time and purpose; the club confirms; the app shows a QR
 * pass valid for that slot only. Visits live in one kv document (single-instance server, writes
 * serialized in-process); the M7 dashboard moves them to a table if volume needs it.
 */
export const HQ_VISITS_KEY = 'hq:visits';

const RIYADH_OFFSET_MS = 3 * 3_600_000;
const PASS_GRACE_MINUTES = 15;
const KEEP_DAYS = 90;
const QR_PREFIX = 'VCHQ';

export type VisitStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

/** M109a: the two hours-wallet space types (one of each; a booking locks its span). */
export type HqSpace = 'office' | 'meeting';

export const HQ_SPACE_LABELS: Record<HqSpace, string> = { office: 'مكتب خاص', meeting: 'حجز قاعة الاجتماعات' };

export type Visit = {
  id: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  purpose: string;
  note: string;
  status: VisitStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: number | null;
  adminNote: string | null;
  passCode: string | null;
  /** M109a: set on hours-wallet bookings; a plain visit carries null/1. */
  space: HqSpace | null;
  hours: number;
  /** The member's membership-year key at booking time, so the approval charges the right year. */
  walletYear: string | null;
  /** M138: the app language at booking — the member's mails follow it. */
  lang?: AppLang;
};

export type PublicVisit = {
  id: string;
  date: string;
  time: string;
  endTime: string;
  purpose: string;
  note: string;
  status: VisitStatus;
  createdAt: string;
  decidedAt: string | null;
  adminNote: string | null;
  hasPass: boolean;
  slotStart: string;
  slotEnd: string;
  cancellable: boolean;
  /** M109a: the hours-wallet booking parts; a plain visit sends null/1. */
  space: HqSpace | null;
  hours: number;
};

export type AdminVisit = PublicVisit & { contactId: number; name: string; phone: string; email: string };

export type PassState = 'upcoming' | 'active' | 'expired';

export type Pass = { visit: PublicVisit; name: string; code: string; qr: string; validFrom: string; validTo: string; state: PassState };

export type HqAccess = 'guest' | 'locked' | 'expired' | 'member';

export type HqOverview = {
  content: Omit<HqContent, 'version' | 'slotCapacity'>;
  access: HqAccess;
  lockedText: string | null;
  days: { date: string; weekday: number }[];
  times: string[];
  /** M81: the owner's HQ photos (uploaded from the dashboard image slots), in slot order. */
  photos: string[];
};

export type BookInput = { date: string; time: string; purpose: string; note: string; space?: HqSpace | null; hours?: number };

/** M109a: the member's annual hours wallet as the app shows it (live counter). */
export type HqWallet = { total: number; used: number; pending: number; remaining: number };

type Deps = { kv: KV; log: FastifyBaseLogger; notifier: Notifier; push: PushService; notices?: MemberNotices };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Today's date and clock in Riyadh (UTC+3), whatever the server's zone. */
export function riyadhNow(now = Date.now()): { date: string; minutes: number } {
  const shifted = new Date(now + RIYADH_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** The slot as absolute instants (Riyadh local time). */
export function slotWindow(date: string, time: string, slotMinutes: number): { start: Date; end: Date } {
  const start = new Date(`${date}T${time}:00+03:00`);
  return { start, end: new Date(start.getTime() + slotMinutes * 60_000) };
}

export function bookableDays(content: HqContent, now = Date.now()): { date: string; weekday: number }[] {
  const today = riyadhNow(now).date;
  const days: { date: string; weekday: number }[] = [];
  for (let offset = Math.max(0, content.leadDays); offset <= content.maxDaysAhead; offset += 1) {
    const date = addDays(today, offset);
    const weekday = weekdayOf(date);
    if (content.hours.days.includes(weekday)) days.push({ date, weekday });
  }
  return days;
}

export function slotTimes(content: HqContent): string[] {
  const { open, close, slotMinutes } = content.hours;
  const times: string[] = [];
  for (let minutes = minutesOf(open); minutes + slotMinutes <= minutesOf(close); minutes += slotMinutes) times.push(timeOf(minutes));
  return times;
}

export function passState(visit: Pick<Visit, 'date' | 'time'>, slotMinutes: number, now = Date.now()): { state: PassState; validFrom: Date; validTo: Date } {
  const { start, end } = slotWindow(visit.date, visit.time, slotMinutes);
  const validFrom = new Date(start.getTime() - PASS_GRACE_MINUTES * 60_000);
  const state: PassState = now < validFrom.getTime() ? 'upcoming' : now <= end.getTime() ? 'active' : 'expired';
  return { state, validFrom, validTo: end };
}

function isOpen(visit: Visit): boolean {
  return visit.status === 'pending' || visit.status === 'confirmed';
}

/** Minutes of one booking: hours-wallet bookings span several slots. */
function durationMinutes(visit: Pick<Visit, 'hours'>, slotMinutes: number): number {
  return slotMinutes * Math.max(1, visit.hours ?? 1);
}

function spansOverlap(aStart: number, aMinutes: number, bStart: number, bMinutes: number): boolean {
  return aStart < bStart + bMinutes && bStart < aStart + aMinutes;
}

const walletKey = (contactId: number): string => `hq:hours:${contactId}`;

type WalletDoc = { year: string; used: number };

export class HqService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  /** The HQ block; the booking rules are the same in both languages, so the logic reads the Arabic one. */
  content(lang: AppLang = 'ar'): Promise<HqContent> {
    return getHqContent(this.deps.kv, lang);
  }

  private async load(): Promise<Visit[]> {
    const stored = await this.deps.kv.get<{ visits: Visit[] }>(HQ_VISITS_KEY);
    // Visits stored before M109a carry no space/hours: they are plain one-slot visits.
    return (stored?.visits ?? []).map((visit) => ({ ...visit, space: visit.space ?? null, hours: visit.hours ?? 1, walletYear: visit.walletYear ?? null }));
  }

  /** Read-modify-write under an in-process lock; old visits are pruned on every write. */
  private mutate<T>(fn: (visits: Visit[]) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const visits = await this.load();
      const result = await fn(visits);
      const cutoff = addDays(riyadhNow().date, -KEEP_DAYS);
      const kept = visits.filter((visit) => visit.date >= cutoff);
      await this.deps.kv.set(HQ_VISITS_KEY, { visits: kept });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private toPublic(visit: Visit, content: HqContent, now = Date.now()): PublicVisit {
    const minutes = durationMinutes(visit, content.hours.slotMinutes);
    const { start, end } = slotWindow(visit.date, visit.time, minutes);
    return {
      id: visit.id,
      date: visit.date,
      time: visit.time,
      endTime: timeOf(minutesOf(visit.time) + minutes),
      purpose: visit.purpose,
      note: visit.note,
      status: visit.status,
      createdAt: visit.createdAt,
      decidedAt: visit.decidedAt,
      adminNote: visit.adminNote,
      hasPass: visit.status === 'confirmed' && Boolean(visit.passCode),
      slotStart: start.toISOString(),
      slotEnd: end.toISOString(),
      cancellable: isOpen(visit) && start.getTime() > now,
      space: visit.space,
      hours: Math.max(1, visit.hours ?? 1),
    };
  }

  private toAdmin(visit: Visit, content: HqContent, now = Date.now()): AdminVisit {
    return { ...this.toPublic(visit, content, now), contactId: visit.contactId, name: visit.name, phone: visit.phone, email: visit.email };
  }

  /** What the management's e-mail needs: who, when, and the booking time. */
  private toMail(visit: Visit, content: HqContent): VisitLike {
    return {
      id: visit.id,
      name: visit.name,
      phone: visit.phone,
      email: visit.email,
      date: visit.date,
      time: visit.time,
      endTime: timeOf(minutesOf(visit.time) + durationMinutes(visit, content.hours.slotMinutes)),
      purpose: visit.purpose,
      note: visit.note,
      createdAt: visit.createdAt,
      adminNote: visit.adminNote,
    };
  }

  static accessOf(me: Me | null): HqAccess {
    if (!me) return 'guest';
    if (me.membership.status === 'active') return 'member';
    return me.membership.status === 'expired' ? 'expired' : 'locked';
  }

  async overview(me: Me | null, now = Date.now(), lang: AppLang = 'ar'): Promise<HqOverview> {
    const content = await this.content(lang);
    const { version: _version, slotCapacity: _capacity, ...visible } = content;
    const access = HqService.accessOf(me);
    return {
      content: visible,
      access,
      lockedText: access === 'member' ? null : access === 'guest' ? content.guestText : content.memberOnlyText,
      days: bookableDays(content, now),
      times: slotTimes(content),
      photos: await hqPhotos(this.deps.kv),
    };
  }

  /** True when [start, start+minutes) of one space is already held by an open booking that day. */
  private static spanTaken(visits: Visit[], date: string, space: HqSpace, startMinutes: number, minutes: number, slotMinutes: number): boolean {
    return visits.some(
      (visit) => isOpen(visit) && visit.date === date && visit.space === space && spansOverlap(startMinutes, minutes, minutesOf(visit.time), durationMinutes(visit, slotMinutes)),
    );
  }

  /**
   * The day's grid. Plain visits count heads against slotCapacity; an hours-wallet space
   * (`space` + wanted `hours`) marks a start time available only when its whole span is free
   * and still inside the working day — taken spans show as unselectable in the calendar.
   */
  async slots(
    date: string,
    now = Date.now(),
    options: { space?: HqSpace | null; hours?: number } = {},
  ): Promise<{ date: string; slots: { time: string; endTime: string; available: boolean }[] }> {
    const content = await this.content();
    if (!DATE.test(date) || !bookableDays(content, now).some((day) => day.date === date)) {
      throw new RequestError('bad_date', 'الموعد خارج فترة الحجز المتاحة');
    }
    const visits = await this.load();
    const { slotMinutes, close } = content.hours;
    const space = options.space ?? null;
    const minutes = slotMinutes * Math.max(1, options.hours ?? 1);
    const slots = slotTimes(content).map((time) => {
      if (space) {
        const fits = minutesOf(time) + minutes <= minutesOf(close);
        const available = fits && !HqService.spanTaken(visits, date, space, minutesOf(time), minutes, slotMinutes);
        return { time, endTime: timeOf(minutesOf(time) + minutes), available };
      }
      const taken = visits.filter((visit) => isOpen(visit) && !visit.space && visit.date === date && visit.time === time).length;
      return { time, endTime: timeOf(minutesOf(time) + slotMinutes), available: taken < content.slotCapacity };
    });
    return { date, slots };
  }

  /** The member's membership-year key: the wallet resets with every new membership year. */
  private static yearKeyOf(me: Me): string {
    return me.membership.endDate ?? `cal:${new Date().getUTCFullYear()}`;
  }

  private async usedHours(contactId: number, year: string): Promise<number> {
    const doc = await this.deps.kv.get<WalletDoc>(walletKey(contactId));
    return doc && doc.year === year ? doc.used : 0;
  }

  /** Confirmed hours move the ledger; pending requests only reserve against the shown balance. */
  private async charge(visit: Visit, deltaHours: number): Promise<void> {
    if (!visit.space || !visit.walletYear) return;
    const used = await this.usedHours(visit.contactId, visit.walletYear);
    await this.deps.kv.set(walletKey(visit.contactId), { year: visit.walletYear, used: Math.max(0, used + deltaHours) } satisfies WalletDoc);
  }

  /** M109a: the live counter — total, deducted (confirmed), reserved (pending) and what remains. */
  async wallet(me: Me): Promise<HqWallet> {
    const content = await this.content();
    const total = content.walletHours ?? 24;
    const year = HqService.yearKeyOf(me);
    const used = await this.usedHours(me.id, year);
    const pending = (await this.load())
      .filter((visit) => visit.contactId === me.id && visit.status === 'pending' && visit.space)
      .reduce((sum, visit) => sum + Math.max(1, visit.hours ?? 1), 0);
    return { total, used, pending, remaining: Math.max(0, total - used - pending) };
  }

  async myVisits(contactId: number, now = Date.now()): Promise<PublicVisit[]> {
    const content = await this.content();
    const visits = (await this.load()).filter((visit) => visit.contactId === contactId);
    return visits.sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map((visit) => this.toPublic(visit, content, now));
  }

  async book(me: Me, input: BookInput, now = Date.now(), lang: AppLang = 'ar'): Promise<PublicVisit> {
    const content = await this.content();
    if (HqService.accessOf(me) !== 'member') throw new RequestError('members_only', content.memberOnlyText, 403);
    if (!DATE.test(input.date) || !bookableDays(content, now).some((day) => day.date === input.date)) {
      throw new RequestError('bad_date', 'الموعد خارج فترة الحجز المتاحة');
    }
    if (!TIME.test(input.time) || !slotTimes(content).includes(input.time)) throw new RequestError('bad_time', 'الوقت خارج ساعات العمل');
    // M109a: an hours-wallet booking (office / meeting room) carries its space and duration;
    // the purpose is the space's own label. A plain visit keeps the picked purpose.
    const space = input.space ?? null;
    const hours = space ? Math.max(1, Math.min(Math.trunc(input.hours ?? 1), 12)) : 1;
    const { slotMinutes, close } = content.hours;
    if (space && minutesOf(input.time) + hours * slotMinutes > minutesOf(close)) {
      throw new RequestError('bad_span', 'المدة المطلوبة تتجاوز ساعات العمل، اختر وقتًا أبكر أو مدة أقصر');
    }
    const purpose = space ? HQ_SPACE_LABELS[space] : input.purpose.trim();
    if (!space && !content.purposes.includes(purpose)) throw new RequestError('bad_purpose', 'اختر الغرض من الزيارة');
    const note = input.note.trim().slice(0, 300);
    const walletYear = space ? HqService.yearKeyOf(me) : null;
    const total = content.walletHours ?? 24;
    const used = space && walletYear ? await this.usedHours(me.id, walletYear) : 0;

    const visit = await this.mutate((visits) => {
      if (visits.some((visit) => visit.contactId === me.id && isOpen(visit) && visit.date === input.date)) {
        throw new RequestError('duplicate', 'لديك حجز في هذا اليوم بالفعل');
      }
      if (space) {
        // The wallet check counts the ledger plus every pending reservation, inside the write lock.
        const reserved = visits
          .filter((visit) => visit.contactId === me.id && visit.status === 'pending' && visit.space)
          .reduce((sum, visit) => sum + Math.max(1, visit.hours ?? 1), 0);
        if (used + reserved + hours > total) {
          throw new RequestError('wallet_exhausted', `رصيد ساعاتك السنوي لا يكفي: المتبقي ${Math.max(0, total - used - reserved)} من ${total} ساعة`);
        }
        if (HqService.spanTaken(visits, input.date, space, minutesOf(input.time), hours * slotMinutes, slotMinutes)) {
          throw new RequestError('full', 'هذا الوقت محجوز، اختر وقتًا آخر');
        }
      } else {
        const taken = visits.filter((visit) => isOpen(visit) && !visit.space && visit.date === input.date && visit.time === input.time).length;
        if (taken >= content.slotCapacity) throw new RequestError('full', 'هذا الوقت مكتمل، اختر وقتًا آخر');
      }
      const visit: Visit = {
        id: randomUUID(),
        contactId: me.id,
        name: me.name,
        phone: me.phone,
        email: me.email,
        date: input.date,
        time: input.time,
        purpose,
        note,
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        decidedAt: null,
        decidedBy: null,
        adminNote: null,
        passCode: null,
        space,
        hours,
        walletYear,
        lang,
      };
      visits.push(visit);
      this.deps.log.info({ visit: visit.id, date: visit.date, time: visit.time, space, hours }, 'hq visit requested');
      return visit;
    });
    const mail = this.toMail(visit, content);
    this.deps.notifier.hqVisitRequested(mail);
    // M138: the member's own receipt.
    this.deps.notices?.received(fromVisit(visit, mail.endTime), { email: me.email, contactEmail: me.contactEmail, name: me.name, lang });
    return this.toPublic(visit, content, now);
  }

  async cancel(contactId: number, id: string, now = Date.now()): Promise<PublicVisit> {
    const content = await this.content();
    const visit = await this.mutate((visits) => {
      const visit = visits.find((entry) => entry.id === id && entry.contactId === contactId);
      if (!visit) throw new RequestError('not_found', 'الحجز غير موجود', 404);
      if (!this.toPublic(visit, content, now).cancellable) throw new RequestError('not_cancellable', 'لا يمكن إلغاء هذا الحجز');
      const wasConfirmed = visit.status === 'confirmed';
      visit.status = 'cancelled';
      return { visit, wasConfirmed };
    }).then(async ({ visit, wasConfirmed }) => {
      // M109a: cancelling a CONFIRMED hours booking before it starts gives the hours back.
      if (wasConfirmed) await this.charge(visit, -Math.max(1, visit.hours ?? 1));
      return visit;
    });
    this.deps.notifier.hqVisitCancelled(this.toMail(visit, content));
    return this.toPublic(visit, content, now);
  }

  /** The QR pass of a confirmed visit: a PNG data URL the app shows as an image. */
  async pass(contactId: number, id: string, now = Date.now()): Promise<Pass> {
    const content = await this.content();
    const visit = (await this.load()).find((entry) => entry.id === id && entry.contactId === contactId);
    if (!visit) throw new RequestError('not_found', 'الحجز غير موجود', 404);
    if (visit.status !== 'confirmed' || !visit.passCode) throw new RequestError('not_confirmed', 'لم تؤكد الإدارة هذا الحجز بعد');
    const { state, validFrom, validTo } = passState(visit, durationMinutes(visit, content.hours.slotMinutes), now);
    const code = `${QR_PREFIX}:${visit.id}:${visit.passCode}`;
    const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
    return { visit: this.toPublic(visit, content, now), name: visit.name, code, qr, validFrom: validFrom.toISOString(), validTo: validTo.toISOString(), state };
  }

  /** M138: every booking of one member, any status, for «متابعة طلباتي». */
  async history(contactId: number, now = Date.now()): Promise<PublicVisit[]> {
    const content = await this.content();
    return (await this.load()).filter((visit) => visit.contactId === contactId).map((visit) => this.toPublic(visit, content, now));
  }

  async adminList(status: VisitStatus | null, now = Date.now()): Promise<AdminVisit[]> {
    const content = await this.content();
    const visits = (await this.load()).filter((visit) => !status || visit.status === status);
    return visits.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)).map((visit) => this.toAdmin(visit, content, now));
  }

  async decide(id: string, status: 'confirmed' | 'rejected', admin: { id: number; name: string }, note: string, now = Date.now()): Promise<AdminVisit> {
    const content = await this.content();
    const visit = await this.mutate((visits) => {
      const visit = visits.find((entry) => entry.id === id);
      if (!visit) throw new RequestError('not_found', 'الحجز غير موجود', 404);
      if (visit.status !== 'pending') throw new RequestError('decided', 'تم البت في هذا الحجز من قبل');
      visit.status = status;
      visit.decidedAt = new Date(now).toISOString();
      visit.decidedBy = admin.id;
      visit.adminNote = note.trim().slice(0, 300) || null;
      visit.passCode = status === 'confirmed' ? randomBytes(9).toString('base64url') : null;
      this.deps.log.info({ visit: visit.id, status, adminId: admin.id }, 'hq visit decided');
      return visit;
    });
    // M109a: only the admin's confirmation moves the hours ledger; a rejection deducts nothing.
    if (status === 'confirmed') await this.charge(visit, Math.max(1, visit.hours ?? 1));
    const mail = this.toMail(visit, content);
    this.deps.notifier.hqVisitDecided(mail, status, admin.name);
    this.deps.push.hqVisitDecided(
      { id: visit.id, contactId: visit.contactId, date: visit.date, time: visit.time, endTime: mail.endTime, adminNote: visit.adminNote, space: visit.space },
      status,
    );
    // M138: the decision mail (the push above already speaks of the barcode / the hours).
    this.deps.notices?.changed(fromVisit(visit, mail.endTime), { email: visit.email, name: visit.name, lang: visit.lang }, { push: false });
    return this.toAdmin(visit, content, now);
  }

  /** Checks a scanned pass: known code, confirmed visit, and inside the slot window. */
  async verify(scanned: string, now = Date.now()): Promise<{ valid: boolean; state: PassState | 'unknown'; visit: AdminVisit | null; text: string }> {
    const content = await this.content();
    const parts = scanned.trim().split(':');
    const secret = parts.length === 3 && parts[0] === QR_PREFIX ? parts[2] : parts[0];
    const visit = (await this.load()).find((entry) => entry.passCode && entry.passCode === secret && entry.status === 'confirmed');
    if (!visit) return { valid: false, state: 'unknown', visit: null, text: 'باركود غير معروف أو حجز غير مؤكد' };
    const { state } = passState(visit, durationMinutes(visit, content.hours.slotMinutes), now);
    const text = state === 'active' ? 'الدخول مسموح' : state === 'upcoming' ? 'الموعد لم يبدأ بعد' : 'انتهى وقت هذا الموعد';
    return { valid: state === 'active', state, visit: this.toAdmin(visit, content), text };
  }
}
