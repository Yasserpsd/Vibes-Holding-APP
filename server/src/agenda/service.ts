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
};

export type AgendaEventInput = Omit<AgendaEvent, 'id' | 'createdAt' | 'updatedAt'>;

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

/** What the viewer sees about one event, with his own registration state folded in. */
export type PublicAgendaEvent = Pick<AgendaEvent, 'id' | 'title' | 'blurb' | 'date' | 'time' | 'endTime' | 'place' | 'mode' | 'feeSar' | 'open'> & {
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

  private toPublic(event: AgendaEvent, mine: AgendaRegistration | null, me: Me | null): PublicAgendaEvent {
    const { id, title, blurb, date, time, endTime, place, mode, feeSar, open } = event;
    const confirmedOnline = Boolean(mine && mine.paid && mine.attendance === 'online');
    return {
      id,
      title,
      blurb,
      date,
      time,
      endTime,
      place,
      mode,
      feeSar,
      open,
      mine: mine ? { attendance: mine.attendance, paid: mine.paid } : null,
      mustPay: Boolean(me && me.membership.status !== 'active' && feeSar > 0),
      onlineUrl: confirmedOnline && event.onlineUrl ? event.onlineUrl : null,
    };
  }

  /** The upcoming events (today included, Riyadh time) with the viewer's own state. */
  async forViewer(me: Me | null, now = Date.now()): Promise<PublicAgendaEvent[]> {
    const today = riyadhDay(now);
    const [events, registrations] = await Promise.all([this.loadEvents(), this.loadRegs()]);
    const mineByEvent = new Map<string, AgendaRegistration>();
    if (me) for (const registration of registrations) if (registration.contactId === me.id) mineByEvent.set(registration.eventId, registration);
    return events.filter((event) => event.date >= today).map((event) => this.toPublic(event, mineByEvent.get(event.id) ?? null, me));
  }

  async viewerEvent(id: string, me: Me | null): Promise<PublicAgendaEvent | null> {
    const event = await this.event(id);
    if (!event) return null;
    const mine = me ? ((await this.loadRegs()).find((entry) => entry.eventId === id && entry.contactId === me.id) ?? null) : null;
    return this.toPublic(event, mine, me);
  }

  /**
   * ONE tap: a member (or a no-fee event) is confirmed at once; otherwise the registration waits on a
   * Paymob payment this call starts. A registration whose payment never finished starts a fresh payment.
   */
  async register(me: Me, eventId: string, attendance: AgendaAttendance, now = Date.now()): Promise<{ registration: AgendaRegistration; payment: PublicPayment | null }> {
    const event = await this.event(eventId);
    if (!event) throw new RequestError('not_found', 'الفعالية غير موجودة', 404);
    if (!event.open) throw new RequestError('closed', 'التسجيل في هذه الفعالية مغلق حاليًا', 409);
    if (event.date < riyadhDay(now)) throw new RequestError('closed', 'هذه الفعالية انتهت', 409);
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

  async create(input: AgendaEventInput, now = Date.now()): Promise<AgendaEvent> {
    const stamp = new Date(now).toISOString();
    const event: AgendaEvent = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    await this.mutateEvents((events) => {
      events.push(event);
    });
    return event;
  }

  async update(id: string, patch: Partial<AgendaEventInput>, now = Date.now()): Promise<AgendaEvent | null> {
    return this.mutateEvents((events) => {
      const event = events.find((entry) => entry.id === id);
      if (!event) return null;
      Object.assign(event, patch, { updatedAt: new Date(now).toISOString() });
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
    const outcome = await this.deps.push.broadcast({
      title: 'أجندة النادي 📅',
      body: `${event.title}${event.date ? ` — ${event.date}` : ''}${event.time ? ` ${event.time}` : ''}. سجّل حضورك من التطبيق.`,
      data: { type: 'agenda', screen: `/agenda/${event.id}` },
    });
    if (outcome.sent === 0) throw new RequestError('no_devices', 'لا توجد أجهزة مسجلة للإشعارات بعد', 409);
    return outcome;
  }
}
