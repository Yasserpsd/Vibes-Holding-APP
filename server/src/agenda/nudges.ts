import type { FastifyBaseLogger } from 'fastify';

import type { AppLang } from '../lang.js';
import { arabicDay, englishDay } from '../mail/notify.js';
import type { PushMessage, PushOutcome } from '../push/service.js';
import { riyadhDay, riyadhDayStart, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';
import { eventDays, type AgendaEvent, type AgendaRegistration } from './service.js';

/**
 * M173 (owner, 2026-10-31: «عايز تذكير كل 12 ساعة أوتوماتيك يوصل على نوتيفيكيشن لأي ورشة موجودة، وكل مرة
 * بصيغة مختلفة»): twice a day — at/after 09:00 and 21:00 Riyadh — every device that has NOT confirmed a seat
 * gets one push about an upcoming open workshop, and the wording changes every time (a bank of templates,
 * rotated per event). With several upcoming workshops the slots rotate through them, one per slot, so nobody
 * gets two pushes at once. Confirmed attendees are skipped (they get the M107 day-before reminder instead).
 * State lives in kv: the last slot served, how many nudges each event got (= which wording comes next).
 */
export const NUDGES_KEY = 'agenda:nudges';
/** Riyadh hours of the two daily slots (news editions are 10:00/19:00, the daily project 12:00). */
export const NUDGE_HOURS = [9, 21] as const;

export type NudgesState = {
  /** `YYYY-MM-DD#HH` of the last slot that went out (or was found empty). */
  lastSlot: string | null;
  lastEventId: string | null;
  lastAt: string | null;
  /** Nudges sent per event — picks the next wording and rotates the events. */
  counts: Record<string, number>;
  /** The owner's switch; default on. */
  enabled: boolean;
};

export type NudgeResult = { eventId: string; title: string; variant: number; sent: number; failed: number };

type AgendaLike = { upcomingOpen(now?: number): Promise<AgendaEvent[]>; registrations(eventId: string): Promise<AgendaRegistration[]> };
type PushLike = { broadcastEach(choose: (device: { contactId: number; persona: string | null; lang: AppLang | null }) => Promise<PushMessage | null> | PushMessage | null): Promise<PushOutcome> };
type Deps = { kv: KV; log: FastifyBaseLogger; agenda: AgendaLike; push: PushLike };

type Facts = { title: string; when: string; daysLeft: number; fee: number; memberFee: number; hq: boolean; online: boolean };
type Template = (facts: Facts) => { title: string; body: string };

/** The fee sentence: members attend without fees (or at the member price), everyone else at the list fee. */
function feeLineAr(f: Facts): string {
  if (f.fee <= 0) return 'الحضور بدون رسوم للجميع.';
  if (f.memberFee <= 0) return `أعضاء النادي يحضرون بدون رسوم، وغير الأعضاء بـ ${f.fee} ريال.`;
  return `الأعضاء بـ ${f.memberFee} ريال بدلًا من ${f.fee} ريال.`;
}
function feeLineEn(f: Facts): string {
  if (f.fee <= 0) return 'Attendance carries no fees for anyone.';
  if (f.memberFee <= 0) return `Club members attend with no fees; others pay SAR ${f.fee}.`;
  return `Members pay SAR ${f.memberFee} instead of SAR ${f.fee}.`;
}
function modeAr(f: Facts): string {
  return f.hq && f.online ? 'حضوريًا في المقر أو أونلاين' : f.online ? 'أونلاين' : 'حضوريًا في مقر النادي';
}
function modeEn(f: Facts): string {
  return f.hq && f.online ? 'in person at the HQ or online' : f.online ? 'online' : 'in person at the club HQ';
}
function leftAr(f: Facts): string {
  if (f.daysLeft <= 0) return 'اليوم';
  if (f.daysLeft === 1) return 'غدًا';
  if (f.daysLeft === 2) return 'بعد يومين';
  if (f.daysLeft <= 10) return `بعد ${f.daysLeft} أيام`;
  return `بعد ${f.daysLeft} يومًا`;
}
function leftEn(f: Facts): string {
  if (f.daysLeft <= 0) return 'today';
  if (f.daysLeft === 1) return 'tomorrow';
  return `in ${f.daysLeft} days`;
}

/** Eight Arabic wordings — the same facts, a different angle every time. */
export const TEMPLATES_AR: Template[] = [
  (f) => ({ title: 'تذكير بالورشة 📅', body: `«${f.title}» ${leftAr(f)} — ${f.when}، ${modeAr(f)}. ${feeLineAr(f)} أكّد حضورك من التطبيق.` }),
  (f) => ({ title: `${leftAr(f)}: «${f.title}»`, body: `${modeAr(f)}، ${f.when}. المقاعد محدودة — احجز مقعدك الآن بضغطة واحدة. ${feeLineAr(f)}` }),
  (f) => ({ title: 'مقعدك في انتظارك 🎯', body: `ورشة «${f.title}» ${leftAr(f)} (${f.when}). ${feeLineAr(f)} لا تؤجّل التأكيد.` }),
  (f) => ({ title: 'هل أكّدت حضورك؟', body: `«${f.title}» تُقام ${leftAr(f)} ${modeAr(f)}. ${feeLineAr(f)} التأكيد يأخذ ثوانٍ من التطبيق.` }),
  (f) => ({ title: `لا تفوّت «${f.title}»`, body: `${leftAr(f)} — ${f.when}، ${modeAr(f)}. خطة واضحة وأدوات عملية تخرج بها. ${feeLineAr(f)}` }),
  (f) => ({ title: 'الورشة تقترب ⏳', body: `${leftAr(f)} «${f.title}» ${modeAr(f)}. ${feeLineAr(f)} أكّد مقعدك قبل اكتمال العدد.` }),
  (f) => ({ title: 'خطوة واحدة تفصلك عن الورشة', body: `«${f.title}» ${leftAr(f)} (${f.when}). افتح التطبيق واضغط «تأكيد الحضور». ${feeLineAr(f)}` }),
  (f) => ({ title: 'تعلّم وتعرّف على أعضاء النادي 🤝', body: `ورشة «${f.title}» ${leftAr(f)}، ${modeAr(f)}. ${feeLineAr(f)} مقعدك بانتظارك.` }),
];

export const TEMPLATES_EN: Template[] = [
  (f) => ({ title: 'Workshop reminder 📅', body: `"${f.title}" ${leftEn(f)} — ${f.when}, ${modeEn(f)}. ${feeLineEn(f)} Confirm your seat in the app.` }),
  (f) => ({ title: `${leftEn(f)}: "${f.title}"`, body: `${modeEn(f)}, ${f.when}. Seats are limited — book yours with one tap. ${feeLineEn(f)}` }),
  (f) => ({ title: 'Your seat is waiting 🎯', body: `"${f.title}" is ${leftEn(f)} (${f.when}). ${feeLineEn(f)} Don't put off confirming.` }),
  (f) => ({ title: 'Have you confirmed your attendance?', body: `"${f.title}" takes place ${leftEn(f)} ${modeEn(f)}. ${feeLineEn(f)} It takes seconds in the app.` }),
  (f) => ({ title: `Don't miss "${f.title}"`, body: `${leftEn(f)} — ${f.when}, ${modeEn(f)}. A clear plan and practical tools to take home. ${feeLineEn(f)}` }),
  (f) => ({ title: 'The workshop is near ⏳', body: `${leftEn(f)}: "${f.title}" ${modeEn(f)}. ${feeLineEn(f)} Confirm before the seats fill up.` }),
  (f) => ({ title: 'One step from the workshop', body: `"${f.title}" ${leftEn(f)} (${f.when}). Open the app and tap "Confirm attendance". ${feeLineEn(f)}` }),
  (f) => ({ title: 'Learn and meet the club members 🤝', body: `"${f.title}" ${leftEn(f)}, ${modeEn(f)}. ${feeLineEn(f)} Your seat is waiting.` }),
];

const emptyState = (): NudgesState => ({ lastSlot: null, lastEventId: null, lastAt: null, counts: {}, enabled: true });

/** The current slot key, or null outside both slots' windows (before 09:00 Riyadh). */
export function slotOf(now: number): string | null {
  const hour = riyadhHour(now);
  const due = [...NUDGE_HOURS].filter((slot) => hour >= slot).at(-1);
  return due === undefined ? null : `${riyadhDay(now)}#${String(due).padStart(2, '0')}`;
}

/** Whole Riyadh days from now until the event's first day (0 = today). */
export function daysUntil(event: Pick<AgendaEvent, 'date' | 'dates'>, now: number): number {
  const first = eventDays(event)[0] ?? event.date;
  return Math.round((riyadhDayStart(first) - riyadhDayStart(riyadhDay(now))) / 86_400_000);
}

export function nudgeMessage(event: AgendaEvent, variant: number, lang: AppLang, now: number): PushMessage {
  const days = eventDays(event);
  const first = days[0] ?? event.date;
  const last = days.at(-1) ?? first;
  const whenAr = days.length > 1 ? `من ${arabicDay(first)} إلى ${arabicDay(last)}` : `${arabicDay(first)}${event.time ? ` الساعة ${event.time}` : ''}`;
  const whenEn = days.length > 1 ? `${englishDay(first)} to ${englishDay(last)}` : `${englishDay(first)}${event.time ? ` at ${event.time}` : ''}`;
  const facts: Facts = {
    title: lang === 'en' ? event.en?.title || event.title : event.title,
    when: lang === 'en' ? whenEn : whenAr,
    daysLeft: daysUntil(event, now),
    fee: event.feeSar,
    memberFee: event.memberFeeSar ?? 0,
    hq: event.mode !== 'online',
    online: event.mode !== 'hq',
  };
  const bank = lang === 'en' ? TEMPLATES_EN : TEMPLATES_AR;
  const template = bank[variant % bank.length] ?? bank[0]!;
  return { ...template(facts), data: { type: 'agenda', eventId: event.id, screen: `/agenda/${event.id}` } };
}

export class WorkshopNudgeService {
  private state: NudgesState | null = null;
  private inflight: Promise<unknown> | null = null;

  constructor(private readonly deps: Deps) {}

  async load(): Promise<NudgesState> {
    if (!this.state) this.state = { ...emptyState(), ...((await this.deps.kv.get<Partial<NudgesState>>(NUDGES_KEY)) ?? {}) };
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await this.deps.kv.set(NUDGES_KEY, this.state);
  }

  async setEnabled(enabled: boolean): Promise<NudgesState> {
    const state = await this.load();
    state.enabled = enabled;
    await this.save();
    return state;
  }

  /** The scheduled tick (every few minutes): one send per slot, when the switch is on. */
  async run(now = Date.now()): Promise<NudgeResult | null> {
    try {
      const state = await this.load();
      const slot = slotOf(now);
      if (!state.enabled || !slot || state.lastSlot === slot) return null;
      return await this.send(now, slot);
    } catch (error) {
      this.deps.log.error({ err: error }, 'workshop nudge failed');
      return null;
    }
  }

  /** The owner's «ابعت التذكير دلوقتي»: goes out at once, whatever the hour; the slot stays untouched. */
  sendNow(now = Date.now()): Promise<NudgeResult | null> {
    return this.send(now, null);
  }

  private send(now: number, slot: string | null): Promise<NudgeResult | null> {
    if (this.inflight) return this.inflight.then(() => null);
    const run = this.doSend(now, slot).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  /** The next event in the rotation: the least-nudged upcoming open workshop, the soonest first among equals. */
  private pick(events: AgendaEvent[], counts: Record<string, number>): AgendaEvent | null {
    const firstDay = (event: AgendaEvent) => eventDays(event)[0] ?? event.date;
    const sorted = [...events].sort((a, b) => (counts[a.id] ?? 0) - (counts[b.id] ?? 0) || firstDay(a).localeCompare(firstDay(b)));
    return sorted[0] ?? null;
  }

  private async doSend(now: number, slot: string | null): Promise<NudgeResult | null> {
    const state = await this.load();
    const events = await this.deps.agenda.upcomingOpen(now);
    if (slot) {
      // The slot is spent even when there is nothing to say: no retry storm every tick.
      state.lastSlot = slot;
      await this.save();
    }
    const event = this.pick(events, state.counts);
    if (!event) return null;
    const variant = state.counts[event.id] ?? 0;
    const confirmed = new Set((await this.deps.agenda.registrations(event.id)).filter((entry) => entry.paid).map((entry) => entry.contactId));
    const messages: Record<AppLang, PushMessage> = { ar: nudgeMessage(event, variant, 'ar', now), en: nudgeMessage(event, variant, 'en', now) };
    const outcome = await this.deps.push.broadcastEach((device) => (confirmed.has(device.contactId) ? null : messages[device.lang === 'en' ? 'en' : 'ar']));
    state.counts[event.id] = variant + 1;
    state.lastEventId = event.id;
    state.lastAt = new Date(now).toISOString();
    // Forget the counters of events that left the agenda.
    for (const id of Object.keys(state.counts)) if (!events.some((entry) => entry.id === id)) delete state.counts[id];
    await this.save();
    this.deps.log.info({ event: event.id, title: event.title, variant, ...outcome }, 'workshop nudge');
    return { eventId: event.id, title: event.title, variant, sent: outcome.sent, failed: outcome.failed };
  }
}
