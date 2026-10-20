import { randomBytes, randomUUID } from 'node:crypto';

import QRCode from 'qrcode';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { AppLang } from '../lang.js';
import type { AppliedDiscount, DiscountsService } from '../discounts/service.js';
import type { InterestsService } from '../interests/service.js';
import { isInterestKey, type InterestKey } from '../interests/types.js';
import type { Notifier } from '../mail/notify.js';
import type { Payment, PaymentsService, PublicPayment } from '../payments/service.js';
import type { PushService } from '../push/service.js';
import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M41 «أجندة النادي» (owner, 2026-09-23): the club's events across the whole year, added from the
 * dashboard at any time. Attendance is ONE tap in the app: a member (or a no-fee event) just picks
 * حضوري or أونلاين; a signed-in visitor without an active membership pays the event's fee inside the
 * app through the existing Paymob path, and only the HMAC-verified webhook confirms him (rule 5).
 */
export const AGENDA_EVENTS_KEY = 'agenda:events';
export const AGENDA_REGISTRATIONS_KEY = 'agenda:registrations';
const MAX_EVENTS = 500;
const MAX_REGISTRATIONS = 10_000;

export type AgendaMode = 'hq' | 'online' | 'both';
export type AgendaAttendance = 'hq' | 'online';

export type AgendaEvent = {
  id: string;
  title: string;
  blurb: string;
  /** Riyadh day `2026-10-05`; `time`/`endTime` are `19:00` texts (may stay empty). */
  date: string;
  /**
   * M70: every day a multi-day workshop runs (sorted, deduped, hand-picked allowed; one time for
   * all days). Absent or empty = the single `date`; `date` always mirrors the first entry so the
   * ordering and every pre-M70 reader keep working.
   */
  dates?: string[];
  time: string;
  endTime: string;
  place: string;
  /** Shown in the app only to a CONFIRMED online attendee. */
  onlineUrl: string;
  /** M77: the owner-uploaded hero image — the event page shows it BIG on top, all details below. */
  imageUrl?: string | null;
  mode: AgendaMode;
  /** The attendance fee for accounts WITHOUT an active membership; 0 = بدون رسوم للجميع. */
  feeSar: number;
  /**
   * M107: the attendance fee for ACTIVE members. 0 or absent = included in the membership.
   * Whoever should attend without paying gets a 100% discount code — never a free price tag.
   */
  memberFeeSar?: number;
  /** M107: the unified interest keys this event suits — targets the push and badges the agenda. */
  interests?: string[];
  open: boolean;
  createdAt: string;
  updatedAt: string;
  /** M43: the English of the owner's words, written once by AI and editable from the dashboard. */
  en?: AgendaEnglish | null;
  /** False once the owner edited the English himself: automatic retranslation then stops. */
  enAuto?: boolean;
};

export type AgendaEnglish = { title: string; blurb: string; place: string | null };

export type AgendaEventInput = Omit<AgendaEvent, 'id' | 'createdAt' | 'updatedAt' | 'en' | 'enAuto'>;

export type AgendaRegistration = {
  id: string;
  eventId: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  attendance: AgendaAttendance;
  /** Held an active membership when registering (his attendance carries no fee). */
  member: boolean;
  /** True once confirmed: at once for members and no-fee events, after the webhook for paid ones. */
  paid: boolean;
  paymentId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** M107: the ticket secret of a confirmed registration (the QR encodes it); older rows get one lazily. */
  passCode?: string | null;
  /** M107: the day-before reminder went out. */
  remindedAt?: string | null;
  /** M107: the discount code applied at registration, for the dashboard list. */
  discountCode?: string | null;
  /** M107: what this attendee actually paid (after any code), SAR. */
  amountSar?: number;
};

/** The days an event runs: the `dates` list of a multi-day workshop, or the single `date`. */
export const eventDays = (event: Pick<AgendaEvent, 'date' | 'dates'>): string[] => (event.dates?.length ? event.dates : [event.date]);
const lastDay = (event: Pick<AgendaEvent, 'date' | 'dates'>): string => eventDays(event).at(-1) ?? event.date;

/** What the viewer sees about one event, with his own registration state folded in. */
export type PublicAgendaEvent = Pick<AgendaEvent, 'id' | 'title' | 'blurb' | 'date' | 'time' | 'endTime' | 'place' | 'mode' | 'feeSar' | 'open'> & {
  /** M70: every day the event runs (always at least the single `date`); an older app ignores it. */
  dates: string[];
  mine: { attendance: AgendaAttendance; paid: boolean } | null;
  /** True when THIS viewer would pay the fee (signed-in, no active membership, fee > 0). */
  mustPay: boolean;
  /** Only for a confirmed online attendee. */
  onlineUrl: string | null;
  /** M77: the big hero image on top of the event page (null = none uploaded). */
  imageUrl: string | null;
  /** M77: the event's last day has passed — the app keeps it listed, faded. */
  past: boolean;
  /** M107: the member price (0 = ضمن العضوية), what THIS viewer pays, and what the membership saves. */
  memberFeeSar: number;
  myFeeSar: number;
  savingsSar: number;
  /** M107: the unified interest keys this event suits (the app badges the matching ones). */
  interests: string[];
};

export type AdminAgendaEvent = AgendaEvent & { counts: { hq: number; online: number; confirmed: number; awaitingPayment: number } };

type Deps = { kv: KV; notifier: Notifier; push: PushService; payments: PaymentsService; discounts?: DiscountsService; interests?: InterestsService; onChange?: () => void };

const ATTENDANCE_LABEL: Record<AgendaAttendance, string> = { hq: 'حضوري في المقر', online: 'أونلاين' };
const TICKET_PREFIX = 'VCEV';
const REMINDER_SWEEP_MS = 30 * 60_000;

export type TicketState = 'upcoming' | 'active' | 'expired';

/** The confirmed attendee's ticket, laid out like the HQ pass: the event, the holder and the QR. */
export type AgendaTicket = {
  event: Pick<AgendaEvent, 'id' | 'title' | 'date' | 'time' | 'endTime' | 'place'> & { dates: string[] };
  name: string;
  attendance: AgendaAttendance;
  attendanceLabel: string;
  code: string;
  qr: string;
  state: TicketState;
};

/** What this viewer pays for an event: the member price with an active membership, else the list fee. */
export function feeFor(event: Pick<AgendaEvent, 'feeSar' | 'memberFeeSar'>, member: boolean): number {
  return member ? (event.memberFeeSar ?? 0) : event.feeSar;
}

export class AgendaService {
  private eventsChain: Promise<unknown> = Promise.resolve();
  private regsChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async loadEvents(): Promise<AgendaEvent[]> {
    return (await this.deps.kv.get<{ events: AgendaEvent[] }>(AGENDA_EVENTS_KEY))?.events ?? [];
  }

  private mutateEvents<T>(change: (events: AgendaEvent[]) => T): Promise<T> {
    const run = this.eventsChain.then(async () => {
      const events = await this.loadEvents();
      const result = change(events);
      events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      await this.deps.kv.set(AGENDA_EVENTS_KEY, { events: events.slice(0, MAX_EVENTS) });
      this.deps.onChange?.();
      return result;
    });
    this.eventsChain = run.catch(() => undefined);
    return run;
  }

  private async loadRegs(): Promise<AgendaRegistration[]> {
    return (await this.deps.kv.get<{ registrations: AgendaRegistration[] }>(AGENDA_REGISTRATIONS_KEY))?.registrations ?? [];
  }

  private mutateRegs<T>(change: (registrations: AgendaRegistration[]) => T): Promise<T> {
    const run = this.regsChain.then(async () => {
      const registrations = await this.loadRegs();
      const result = change(registrations);
      await this.deps.kv.set(AGENDA_REGISTRATIONS_KEY, { registrations: registrations.slice(-MAX_REGISTRATIONS) });
      return result;
    });
    this.regsChain = run.catch(() => undefined);
    return run;
  }

  async event(id: string): Promise<AgendaEvent | null> {
    return (await this.loadEvents()).find((event) => event.id === id) ?? null;
  }

  private toPublic(event: AgendaEvent, mine: AgendaRegistration | null, me: Me | null, lang: 'ar' | 'en' = 'ar', past = false): PublicAgendaEvent {
    const { id, date, time, endTime, mode, feeSar, open } = event;
    // M43: the English app reads the stored English (AI once, owner-editable); anything untranslated stays Arabic.
    const en = lang === 'en' ? (event.en ?? null) : null;
    const confirmedOnline = Boolean(mine && mine.paid && mine.attendance === 'online');
    const member = me?.membership.status === 'active';
    const memberFeeSar = event.memberFeeSar ?? 0;
    const myFeeSar = feeFor(event, member === true);
    return {
      id,
      title: en?.title || event.title,
      blurb: en?.blurb || event.blurb,
      date,
      dates: eventDays(event),
      time,
      endTime,
      place: en?.place || event.place,
      mode,
      feeSar,
      memberFeeSar,
      myFeeSar,
      // M107 «وفّر بالعضوية»: what the membership shaves off this event for a non-member viewer.
      savingsSar: !member && feeSar > memberFeeSar ? feeSar - memberFeeSar : 0,
      interests: (event.interests ?? []).filter(isInterestKey),
      // A finished event never registers, whatever the stored flag says.
      open: open && !past,
      mine: mine ? { attendance: mine.attendance, paid: mine.paid } : null,
      mustPay: Boolean(me && myFeeSar > 0),
      onlineUrl: confirmedOnline && event.onlineUrl ? event.onlineUrl : null,
      imageUrl: event.imageUrl || null,
      past,
    };
  }

  /** M77: a finished event stays listed (faded in the app) this many days before it leaves the agenda. */
  private static readonly PAST_KEPT_DAYS = 90;

  /** The upcoming events first (today included, Riyadh time), then the recently finished ones flagged `past`, with the viewer's own state. */
  async forViewer(me: Me | null, lang: 'ar' | 'en' = 'ar', now = Date.now()): Promise<PublicAgendaEvent[]> {
    const today = riyadhDay(now);
    const keptFrom = riyadhDay(now - AgendaService.PAST_KEPT_DAYS * 24 * 60 * 60 * 1000);
    const [events, registrations] = await Promise.all([this.loadEvents(), this.loadRegs()]);
    const mineByEvent = new Map<string, AgendaRegistration>();
    if (me) for (const registration of registrations) if (registration.contactId === me.id) mineByEvent.set(registration.eventId, registration);
    const publish = (event: AgendaEvent, past: boolean) => this.toPublic(event, mineByEvent.get(event.id) ?? null, me, lang, past);
    // M70: a workshop stays on the agenda (and open) until its LAST day has passed.
    const upcoming = events.filter((event) => lastDay(event) >= today).map((event) => publish(event, false));
    // M77 (owner, 2026-10-16): «الورش السابقة تفضل موجودة ولكن باهتة» — the most recent first, after the upcoming ones.
    const past = events
      .filter((event) => lastDay(event) < today && lastDay(event) >= keptFrom)
      .sort((a, b) => lastDay(b).localeCompare(lastDay(a)))
      .map((event) => publish(event, true));
    return [...upcoming, ...past];
  }

  /** M75: when each currently-listed upcoming event was created — the home badge counts the fresh ones. */
  async createdTimes(now = Date.now()): Promise<string[]> {
    const today = riyadhDay(now);
    return (await this.loadEvents()).filter((event) => lastDay(event) >= today).map((event) => event.createdAt);
  }

  async viewerEvent(id: string, me: Me | null, lang: 'ar' | 'en' = 'ar'): Promise<PublicAgendaEvent | null> {
    const event = await this.event(id);
    if (!event) return null;
    const mine = me ? ((await this.loadRegs()).find((entry) => entry.eventId === id && entry.contactId === me.id) ?? null) : null;
    return this.toPublic(event, mine, me, lang, lastDay(event) < riyadhDay(Date.now()));
  }

  /** M43: the English of the event — `auto: false` records the owner's own wording and stops retranslation. */
  async setEnglish(id: string, en: AgendaEnglish | null, auto: boolean): Promise<AgendaEvent | null> {
    return this.mutateEvents((events) => {
      const event = events.find((entry) => entry.id === id);
      if (!event) return null;
      event.en = en;
      event.enAuto = auto;
      return event;
    });
  }

  private static ticketCode(): string {
    return randomBytes(9).toString('base64url');
  }

  /** M107: what a code does to this viewer's fee, checked before registering («تحقق من الكود»). */
  async previewDiscount(me: Me, eventId: string, code: string, now = Date.now()): Promise<AppliedDiscount> {
    if (!this.deps.discounts) throw new RequestError('not_found', 'كود الخصم غير صحيح', 404);
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    const fee = feeFor(event, me.membership.status === 'active');
    if (fee <= 0) throw new RequestError('no_fee', 'لا توجد رسوم على حضورك لهذه الفعالية');
    return this.deps.discounts.apply(code, fee, now);
  }

  /**
   * ONE tap: a viewer with no fee (member of an event ضمن العضوية, or a no-fee event) is confirmed at
   * once; a 100% code confirms with no checkout; otherwise the registration waits on the payment this
   * call starts. A registration whose payment never finished starts a fresh payment.
   */
  async register(me: Me, eventId: string, attendance: AgendaAttendance, discountCode?: string, lang: AppLang = 'ar', now = Date.now()): Promise<{ registration: AgendaRegistration; payment: PublicPayment | null }> {
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    if (!event.open) throw new RequestError('closed', 'التسجيل في هذه الفعالية مغلق حاليًا', 409);
    if (lastDay(event) < riyadhDay(now)) throw new RequestError('closed', 'هذه الفعالية انتهت', 409);
    if (event.mode !== 'both' && event.mode !== attendance) {
      throw new RequestError('invalid', event.mode === 'hq' ? 'هذه الفعالية حضورية فقط' : 'هذه الفعالية أونلاين فقط', 400);
    }
    const member = me.membership.status === 'active';
    const fee = feeFor(event, member);
    // M107: the code is validated BEFORE the registration is touched, so a bad code changes nothing.
    const discount = discountCode && fee > 0 && this.deps.discounts ? await this.deps.discounts.apply(discountCode, fee, now) : undefined;
    const due = discount ? discount.amountAfter : fee;
    const stamp = new Date(now).toISOString();

    const existing = await this.mutateRegs((registrations) => {
      const mine = registrations.find((entry) => entry.eventId === eventId && entry.contactId === me.id);
      if (mine?.paid) throw new RequestError('already_registered', 'سجّلنا حضورك في هذه الفعالية من قبل', 409);
      if (mine) {
        // An unfinished payment: the member may switch the attendance and gets a fresh checkout below.
        mine.attendance = attendance;
        mine.member = member;
        return mine;
      }
      const created: AgendaRegistration = {
        id: randomUUID(),
        eventId,
        contactId: me.id,
        name: me.name,
        phone: me.phone,
        email: me.email,
        personaLabel: me.personaLabel,
        attendance,
        member,
        paid: false,
        paymentId: null,
        createdAt: stamp,
        confirmedAt: null,
      };
      registrations.push(created);
      return created;
    });

    const confirm = (paymentId: string | null) =>
      this.mutateRegs((registrations) => {
        const mine = registrations.find((entry) => entry.id === existing.id);
        if (!mine) throw new RequestError('not_found', 'التسجيل غير موجود', 404);
        mine.paid = true;
        mine.paymentId = paymentId;
        mine.confirmedAt = stamp;
        mine.passCode = mine.passCode ?? AgendaService.ticketCode();
        mine.discountCode = discount?.code ?? null;
        mine.amountSar = due;
        return mine;
      });

    if (fee <= 0) {
      const confirmed = await confirm(null);
      this.deps.notifier.agendaRegistered(confirmed, event);
      return { registration: confirmed, payment: null };
    }

    const payment = await this.deps.payments.startAgenda(me, {
      eventId,
      eventTitle: event.title,
      attendanceLabel: ATTENDANCE_LABEL[attendance],
      amountSar: due,
      memberPrice: member,
      discount,
      lang,
    });
    if (payment.status === 'paid') {
      // A 100% code settled at zero on the spot (the payments push already told the member).
      const confirmed = await confirm(payment.id);
      this.deps.notifier.agendaRegistered(confirmed, event);
      return { registration: confirmed, payment };
    }
    const pending = await this.mutateRegs((registrations) => {
      const mine = registrations.find((entry) => entry.id === existing.id);
      if (!mine) throw new RequestError('not_found', 'التسجيل غير موجود', 404);
      mine.paymentId = payment.id;
      mine.discountCode = discount?.code ?? null;
      mine.amountSar = due;
      return mine;
    });
    return { registration: pending, payment };
  }

  /** Hears every settled payment; an agenda fee that was paid confirms its registration (rule 5). */
  paymentSettled(payment: Payment): void {
    if (!payment.serviceKey.startsWith('agenda:') || payment.status !== 'paid') return;
    void (async () => {
      const confirmed = await this.mutateRegs((registrations) => {
        const mine = registrations.find((entry) => entry.paymentId === payment.id);
        if (!mine || mine.paid) return null;
        mine.paid = true;
        mine.confirmedAt = new Date().toISOString();
        mine.passCode = mine.passCode ?? AgendaService.ticketCode();
        return mine;
      });
      if (!confirmed) return;
      const event = await this.event(confirmed.eventId);
      if (event) {
        this.deps.notifier.agendaRegistered(confirmed, event);
        this.deps.push.agendaConfirmed(confirmed.contactId, event.title, event.id);
      }
    })();
  }

  // ── M107: tickets ───────────────────────────────────────────────────────────

  private ticketStateOf(event: AgendaEvent, now = Date.now()): TicketState {
    const today = riyadhDay(now);
    const days = eventDays(event);
    if (today < (days[0] ?? event.date)) return 'upcoming';
    return today > (days.at(-1) ?? event.date) ? 'expired' : 'active';
  }

  /** The confirmed attendee's ticket: event details plus the QR (a pre-M107 confirmation gets its code here). */
  async ticket(contactId: number, eventId: string, now = Date.now()): Promise<AgendaTicket> {
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    let mine = (await this.loadRegs()).find((entry) => entry.eventId === eventId && entry.contactId === contactId);
    if (!mine || !mine.paid) throw new RequestError('not_confirmed', 'لم يتأكد حضورك في هذه الفعالية بعد', 404);
    if (!mine.passCode) {
      mine = await this.mutateRegs((registrations) => {
        const row = registrations.find((entry) => entry.id === (mine as AgendaRegistration).id);
        if (!row) throw new RequestError('not_found', 'التسجيل غير موجود', 404);
        row.passCode = row.passCode ?? AgendaService.ticketCode();
        return row;
      });
    }
    const code = `${TICKET_PREFIX}:${mine.id}:${mine.passCode}`;
    const qr = await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
    return {
      event: { id: event.id, title: event.title, date: event.date, dates: eventDays(event), time: event.time, endTime: event.endTime, place: event.place },
      name: mine.name,
      attendance: mine.attendance,
      attendanceLabel: ATTENDANCE_LABEL[mine.attendance],
      code,
      qr,
      state: this.ticketStateOf(event, now),
    };
  }

  /** Checks a scanned ticket at the door: known code, confirmed registration, and an event day. */
  async verifyTicket(scanned: string, now = Date.now()): Promise<{ valid: boolean; text: string; attendee: { name: string; phone: string; attendance: AgendaAttendance; eventTitle: string } | null }> {
    const parts = scanned.trim().split(':');
    const secret = parts.length === 3 && parts[0] === TICKET_PREFIX ? parts[2] : parts[0];
    const mine = (await this.loadRegs()).find((entry) => entry.passCode && entry.passCode === secret && entry.paid);
    if (!mine) return { valid: false, text: 'تذكرة غير معروفة أو حضور غير مؤكد', attendee: null };
    const event = await this.event(mine.eventId);
    if (!event) return { valid: false, text: 'الفعالية غير موجودة', attendee: null };
    const attendee = { name: mine.name, phone: mine.phone, attendance: mine.attendance, eventTitle: event.title };
    const today = riyadhDay(now);
    const days = eventDays(event);
    if (today < (days[0] ?? event.date)) return { valid: false, text: 'الفعالية لم تبدأ بعد', attendee };
    if (today > (days.at(-1) ?? event.date)) return { valid: false, text: 'انتهت هذه الفعالية', attendee };
    return { valid: true, text: 'الدخول مسموح', attendee };
  }

  // ── M107: the day-before reminder ───────────────────────────────────────────

  private reminderTimer: NodeJS.Timeout | null = null;

  startReminders(): void {
    if (this.reminderTimer) return;
    this.reminderTimer = setInterval(() => void this.sweepReminders().catch(() => undefined), REMINDER_SWEEP_MS);
    this.reminderTimer.unref();
  }

  stopReminders(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.reminderTimer = null;
  }

  /** Every confirmed attendee whose event starts tomorrow (Riyadh) hears once. */
  async sweepReminders(now = Date.now()): Promise<number> {
    const tomorrow = riyadhDay(now + 24 * 60 * 60 * 1000);
    const events = (await this.loadEvents()).filter((event) => (eventDays(event)[0] ?? event.date) === tomorrow);
    if (events.length === 0) return 0;
    const byId = new Map(events.map((event) => [event.id, event]));
    const due = await this.mutateRegs((registrations) => {
      const rows: AgendaRegistration[] = [];
      for (const entry of registrations) {
        if (!entry.paid || entry.remindedAt || !byId.has(entry.eventId)) continue;
        entry.remindedAt = new Date(now).toISOString();
        rows.push({ ...entry });
      }
      return rows;
    });
    for (const entry of due) {
      const event = byId.get(entry.eventId);
      if (event) this.deps.push.agendaReminder(entry.contactId, { id: event.id, title: event.title, date: event.date, time: event.time });
    }
    return due.length;
  }

  // ── dashboard ──────────────────────────────────────────────────────────────

  async adminEvents(): Promise<AdminAgendaEvent[]> {
    const [events, registrations] = await Promise.all([this.loadEvents(), this.loadRegs()]);
    return events
      .map((event) => {
        const rows = registrations.filter((entry) => entry.eventId === event.id);
        return {
          ...event,
          counts: {
            hq: rows.filter((entry) => entry.paid && entry.attendance === 'hq').length,
            online: rows.filter((entry) => entry.paid && entry.attendance === 'online').length,
            confirmed: rows.filter((entry) => entry.paid).length,
            awaitingPayment: rows.filter((entry) => !entry.paid).length,
          },
        };
      })
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }

  /** M70: the day list arrives hand-picked from the dashboard — sorted and deduped here, a single day collapses to `date`, and `date` mirrors the first day. */
  private static normalizeDays<T extends { date?: string; dates?: string[] }>(fields: T): T {
    if (fields.dates === undefined) return fields;
    const days = [...new Set(fields.dates)].sort();
    if (days.length <= 1) return { ...fields, dates: undefined, date: days[0] ?? fields.date };
    return { ...fields, dates: days, date: days[0] };
  }

  async create(input: AgendaEventInput, now = Date.now()): Promise<AgendaEvent> {
    const stamp = new Date(now).toISOString();
    const event: AgendaEvent = { ...AgendaService.normalizeDays(input), id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    await this.mutateEvents((events) => {
      events.push(event);
    });
    return event;
  }

  async update(id: string, patch: Partial<AgendaEventInput>, now = Date.now()): Promise<AgendaEvent | null> {
    return this.mutateEvents((events) => {
      const event = events.find((entry) => entry.id === id);
      if (!event) return null;
      // A single-day edit of a multi-day event keeps the first day in step with the list.
      const fields = AgendaService.normalizeDays({ ...patch, ...(patch.dates === undefined && patch.date !== undefined && event.dates?.length ? { dates: [patch.date, ...event.dates.slice(1)] } : {}) });
      Object.assign(event, fields, { updatedAt: new Date(now).toISOString() });
      return event;
    });
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.mutateEvents((events) => {
      const index = events.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      events.splice(index, 1);
      return true;
    });
    if (removed) {
      await this.mutateRegs((registrations) => {
        for (let index = registrations.length - 1; index >= 0; index -= 1) {
          if (registrations[index]?.eventId === id) registrations.splice(index, 1);
        }
      });
    }
    return removed;
  }

  async registrations(eventId: string): Promise<AgendaRegistration[]> {
    return (await this.loadRegs()).filter((entry) => entry.eventId === eventId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** «نبّه الأعضاء»: one push to every registered device about this event. */
  async notify(eventId: string): Promise<{ sent: number; failed: number; dropped: number }> {
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    // M70: a multi-day workshop announces its span in words (never a hyphen between two numbers).
    const days = eventDays(event);
    const when = days.length > 1 ? `من ${days[0]} إلى ${days.at(-1)}` : event.date;
    const message = {
      title: 'أجندة النادي 📅',
      body: `${event.title}${when ? ` — ${when}` : ''}${event.time ? ` ${event.time}` : ''}. سجّل حضورك من التطبيق.`,
      data: { type: 'agenda', screen: `/agenda/${event.id}` },
    };
    // M107: a tagged event reaches the members who picked a matching interest — and everyone who never picked any.
    const tags = (event.interests ?? []).filter(isInterestKey);
    let outcome;
    if (tags.length > 0 && this.deps.interests) {
      const wanted = new Set<number>();
      let savedAny = new Set<number>();
      for (const tag of tags) {
        const sets = await this.deps.interests.contactsFor(tag as InterestKey);
        for (const id of sets.picked) wanted.add(id);
        savedAny = sets.savedAny;
      }
      outcome = await this.deps.push.broadcastWhere(message, (contactId) => wanted.has(contactId) || !savedAny.has(contactId));
    } else {
      outcome = await this.deps.push.broadcast(message);
    }
    if (outcome.sent === 0) throw new RequestError('no_devices', 'لا توجد أجهزة مسجلة للإشعارات بعد', 409);
    return outcome;
  }
}
