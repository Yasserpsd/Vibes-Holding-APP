import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
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
  mode: AgendaMode;
  /** The attendance fee for accounts WITHOUT an active membership; 0 = بدون رسوم للجميع. Members never pay. */
  feeSar: number;
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
};

export type AdminAgendaEvent = AgendaEvent & { counts: { hq: number; online: number; confirmed: number; awaitingPayment: number } };

type Deps = { kv: KV; notifier: Notifier; push: PushService; payments: PaymentsService; onChange?: () => void };

const ATTENDANCE_LABEL: Record<AgendaAttendance, string> = { hq: 'حضوري في المقر', online: 'أونلاين' };

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

  private toPublic(event: AgendaEvent, mine: AgendaRegistration | null, me: Me | null, lang: 'ar' | 'en' = 'ar'): PublicAgendaEvent {
    const { id, date, time, endTime, mode, feeSar, open } = event;
    // M43: the English app reads the stored English (AI once, owner-editable); anything untranslated stays Arabic.
    const en = lang === 'en' ? (event.en ?? null) : null;
    const confirmedOnline = Boolean(mine && mine.paid && mine.attendance === 'online');
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
      open,
      mine: mine ? { attendance: mine.attendance, paid: mine.paid } : null,
      mustPay: Boolean(me && me.membership.status !== 'active' && feeSar > 0),
      onlineUrl: confirmedOnline && event.onlineUrl ? event.onlineUrl : null,
    };
  }

  /** The upcoming events (today included, Riyadh time) with the viewer's own state. */
  async forViewer(me: Me | null, lang: 'ar' | 'en' = 'ar', now = Date.now()): Promise<PublicAgendaEvent[]> {
    const today = riyadhDay(now);
    const [events, registrations] = await Promise.all([this.loadEvents(), this.loadRegs()]);
    const mineByEvent = new Map<string, AgendaRegistration>();
    if (me) for (const registration of registrations) if (registration.contactId === me.id) mineByEvent.set(registration.eventId, registration);
    // M70: a workshop stays on the agenda (and open) until its LAST day has passed.
    return events.filter((event) => lastDay(event) >= today).map((event) => this.toPublic(event, mineByEvent.get(event.id) ?? null, me, lang));
  }

  async viewerEvent(id: string, me: Me | null, lang: 'ar' | 'en' = 'ar'): Promise<PublicAgendaEvent | null> {
    const event = await this.event(id);
    if (!event) return null;
    const mine = me ? ((await this.loadRegs()).find((entry) => entry.eventId === id && entry.contactId === me.id) ?? null) : null;
    return this.toPublic(event, mine, me, lang);
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

  /**
   * ONE tap: a member (or a no-fee event) is confirmed at once; otherwise the registration waits on a
   * Paymob payment this call starts. A registration whose payment never finished starts a fresh payment.
   */
  async register(me: Me, eventId: string, attendance: AgendaAttendance, now = Date.now()): Promise<{ registration: AgendaRegistration; payment: PublicPayment | null }> {
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    if (!event.open) throw new RequestError('closed', 'التسجيل في هذه الفعالية مغلق حاليًا', 409);
    if (lastDay(event) < riyadhDay(now)) throw new RequestError('closed', 'هذه الفعالية انتهت', 409);
    if (event.mode !== 'both' && event.mode !== attendance) {
      throw new RequestError('invalid', event.mode === 'hq' ? 'هذه الفعالية حضورية فقط' : 'هذه الفعالية أونلاين فقط', 400);
    }
    const member = me.membership.status === 'active';
    const free = member || event.feeSar <= 0;
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

    if (free) {
      const confirmed = await this.mutateRegs((registrations) => {
        const mine = registrations.find((entry) => entry.id === existing.id);
        if (!mine) throw new RequestError('not_found', 'التسجيل غير موجود', 404);
        mine.paid = true;
        mine.paymentId = null;
        mine.confirmedAt = stamp;
        return mine;
      });
      this.deps.notifier.agendaRegistered(confirmed, event);
      return { registration: confirmed, payment: null };
    }

    const payment = await this.deps.payments.startAgenda(me, {
      eventId,
      eventTitle: event.title,
      attendanceLabel: ATTENDANCE_LABEL[attendance],
      amountSar: event.feeSar,
    });
    const pending = await this.mutateRegs((registrations) => {
      const mine = registrations.find((entry) => entry.id === existing.id);
      if (!mine) throw new RequestError('not_found', 'التسجيل غير موجود', 404);
      mine.paymentId = payment.id;
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
    const outcome = await this.deps.push.broadcast({
      title: 'أجندة النادي 📅',
      body: `${event.title}${when ? ` — ${when}` : ''}${event.time ? ` ${event.time}` : ''}. سجّل حضورك من التطبيق.`,
      data: { type: 'agenda', screen: `/agenda/${event.id}` },
    });
    if (outcome.sent === 0) throw new RequestError('no_devices', 'لا توجد أجهزة مسجلة للإشعارات بعد', 409);
    return outcome;
  }
}
