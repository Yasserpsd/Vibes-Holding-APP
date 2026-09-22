import { randomBytes, randomUUID } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';
import QRCode from 'qrcode';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import { getHqContent, type HqContent } from '../content/hq.js';
import type { AppLang } from '../lang.js';
import type { Notifier, VisitLike } from '../mail/notify.js';
import type { PushService } from '../push/service.js';
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
};

export type BookInput = { date: string; time: string; purpose: string; note: string };

type Deps = { kv: KV; log: FastifyBaseLogger; notifier: Notifier; push: PushService };

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

export class HqService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  /** The HQ block; the booking rules are the same in both languages, so the logic reads the Arabic one. */
  content(lang: AppLang = 'ar'): Promise<HqContent> {
    return getHqContent(this.deps.kv, lang);
  }

  private async load(): Promise<Visit[]> {
    const stored = await this.deps.kv.get<{ visits: Visit[] }>(HQ_VISITS_KEY);
    return stored?.visits ?? [];
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
    const { start, end } = slotWindow(visit.date, visit.time, content.hours.slotMinutes);
    return {
      id: visit.id,
      date: visit.date,
      time: visit.time,
      endTime: timeOf(minutesOf(visit.time) + content.hours.slotMinutes),
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
      endTime: timeOf(minutesOf(visit.time) + content.hours.slotMinutes),
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
    };
  }

  async slots(date: string, now = Date.now()): Promise<{ date: string; slots: { time: string; endTime: string; available: boolean }[] }> {
    const content = await this.content();
    if (!DATE.test(date) || !bookableDays(content, now).some((day) => day.date === date)) {
      throw new RequestError('bad_date', 'الموعد خارج فترة الحجز المتاحة');
    }
    const visits = await this.load();
    const slots = slotTimes(content).map((time) => {
      const taken = visits.filter((visit) => isOpen(visit) && visit.date === date && visit.time === time).length;
      return { time, endTime: timeOf(minutesOf(time) + content.hours.slotMinutes), available: taken < content.slotCapacity };
    });
    return { date, slots };
  }

  async myVisits(contactId: number, now = Date.now()): Promise<PublicVisit[]> {
    const content = await this.content();
    const visits = (await this.load()).filter((visit) => visit.contactId === contactId);
    return visits.sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map((visit) => this.toPublic(visit, content, now));
  }

  async book(me: Me, input: BookInput, now = Date.now()): Promise<PublicVisit> {
    const content = await this.content();
    if (HqService.accessOf(me) !== 'member') throw new RequestError('members_only', content.memberOnlyText, 403);
    if (!DATE.test(input.date) || !bookableDays(content, now).some((day) => day.date === input.date)) {
      throw new RequestError('bad_date', 'الموعد خارج فترة الحجز المتاحة');
    }
    if (!TIME.test(input.time) || !slotTimes(content).includes(input.time)) throw new RequestError('bad_time', 'الوقت خارج ساعات العمل');
    const purpose = input.purpose.trim();
    if (!content.purposes.includes(purpose)) throw new RequestError('bad_purpose', 'اختر الغرض من الزيارة');
    const note = input.note.trim().slice(0, 300);

    const visit = await this.mutate((visits) => {
      if (visits.some((visit) => visit.contactId === me.id && isOpen(visit) && visit.date === input.date)) {
        throw new RequestError('duplicate', 'لديك حجز في هذا اليوم بالفعل');
      }
      const taken = visits.filter((visit) => isOpen(visit) && visit.date === input.date && visit.time === input.time).length;
      if (taken >= content.slotCapacity) throw new RequestError('full', 'هذا الوقت مكتمل، اختر وقتًا آخر');
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
      };
      visits.push(visit);
      this.deps.log.info({ visit: visit.id, date: visit.date, time: visit.time }, 'hq visit requested');
      return visit;
    });
    this.deps.notifier.hqVisitRequested(this.toMail(visit, content));
    return this.toPublic(visit, content, now);
  }

  async cancel(contactId: number, id: string, now = Date.now()): Promise<PublicVisit> {
    const content = await this.content();
    const visit = await this.mutate((visits) => {
      const visit = visits.find((entry) => entry.id === id && entry.contactId === contactId);
      if (!visit) throw new RequestError('not_found', 'الحجز غير موجود', 404);
      if (!this.toPublic(visit, content, now).cancellable) throw new RequestError('not_cancellable', 'لا يمكن إلغاء هذا الحجز');
      visit.status = 'cancelled';
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
    const { state, validFrom, validTo } = passState(visit, content.hours.slotMinutes, now);
    const code = `${QR_PREFIX}:${visit.id}:${visit.passCode}`;
    const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
    return { visit: this.toPublic(visit, content, now), name: visit.name, code, qr, validFrom: validFrom.toISOString(), validTo: validTo.toISOString(), state };
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
    const mail = this.toMail(visit, content);
    this.deps.notifier.hqVisitDecided(mail, status, admin.name);
    this.deps.push.hqVisitDecided({ id: visit.id, contactId: visit.contactId, date: visit.date, time: visit.time, endTime: mail.endTime, adminNote: visit.adminNote }, status);
    return this.toAdmin(visit, content, now);
  }

  /** Checks a scanned pass: known code, confirmed visit, and inside the slot window. */
  async verify(scanned: string, now = Date.now()): Promise<{ valid: boolean; state: PassState | 'unknown'; visit: AdminVisit | null; text: string }> {
    const content = await this.content();
    const parts = scanned.trim().split(':');
    const secret = parts.length === 3 && parts[0] === QR_PREFIX ? parts[2] : parts[0];
    const visit = (await this.load()).find((entry) => entry.passCode && entry.passCode === secret && entry.status === 'confirmed');
    if (!visit) return { valid: false, state: 'unknown', visit: null, text: 'باركود غير معروف أو حجز غير مؤكد' };
    const { state } = passState(visit, content.hours.slotMinutes, now);
    const text = state === 'active' ? 'الدخول مسموح' : state === 'upcoming' ? 'الموعد لم يبدأ بعد' : 'انتهى وقت هذا الموعد';
    return { valid: state === 'active', state, visit: this.toAdmin(visit, content), text };
  }
}
