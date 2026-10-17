import type { FastifyBaseLogger } from 'fastify';

import type { AgendaService } from '../agenda/service.js';
import type { Config } from '../config.js';
import { getGoldenContent } from '../content/golden.js';
import type { ProjectsService } from '../projectsBank/service.js';
import type { PushService } from '../push/service.js';
import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M87 «المستشار عضو أساسي» (owner): ONE personal push from the advisor to every member, every
 * day — persona-matched, built ENTIRELY from live data the server already holds (the golden
 * list, the Projects Bank snapshot, the agenda). ZERO per-send AI cost and ZERO per-member
 * calls, so the Zid-scale waves (10,000+ members at once) cost nothing: three persona
 * broadcasts a day, whatever the member count. Tapping opens the advisor (`data.screen`),
 * so the habit the owner wants — «يتعودوا عليه ويكلموه» — forms in the conversation itself.
 *
 * M60's lesson is kept: one message a day at a human hour, COMPANION_PUSH=0 kills it cold,
 * and (M87b) every member can mute his daily message from the app — the wave skips him.
 *
 * M87b templates: the message POOLS live in kv, owner-editable from the dashboard. A template
 * is plain Arabic with placeholders filled from live data at send time: {golden} the day's
 * golden pick, {project}/{sector} the day's bank pick, {event}/{eventDate} the next event.
 * A template whose placeholder has no data today is skipped for the next one in the pool.
 */

const SENT_KEY = 'companion:lastDay';
const TEMPLATES_KEY = 'companion:templates';
const MUTED_KEY = 'companion:muted';
const TICK_MS = 10 * 60_000;
/** The push goes out in this Riyadh hour (11:00–11:59) — mid-morning, never at night. */
const SEND_HOUR = 11;

const riyadhHour = (now: number): number => new Date(now + 3 * 3_600_000).getUTCHours();
/** A stable daily index for the rotations: the day number, Riyadh calendar. */
const dayIndex = (now: number): number => Math.floor((now + 3 * 3_600_000) / 86_400_000);

export type CompanionPersona = 'investor' | 'entrepreneur' | 'neutral';
export const COMPANION_PERSONAS: readonly CompanionPersona[] = ['investor', 'entrepreneur', 'neutral'];

export type CompanionTemplate = { title: string; body: string };
export type CompanionTemplates = Record<CompanionPersona, CompanionTemplate[]>;

/** The placeholders a template may carry; anything else stays literal text. */
export const COMPANION_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'golden', label: 'اسم مشروع ذهبي يتبدل يوميًا' },
  { key: 'project', label: 'اسم مشروع من بنك المشاريع يتبدل يوميًا' },
  { key: 'sector', label: 'قطاع مشروع البنك المرشح' },
  { key: 'event', label: 'اسم أقرب فعالية قادمة' },
  { key: 'eventDate', label: 'تاريخ أقرب فعالية قادمة' },
];

/** The owner's starting pools — the dashboard edits them; «استرجاع» writes these back. */
export const COMPANION_SEED: CompanionTemplates = {
  investor: [
    { title: 'ترشيح اليوم من مستشارك', body: 'ألقِ نظرة على «{golden}» من المشاريع الذهبية — تواصلك مع أي مشروع ذهبي لا يخصم من رصيدك. افتح المحادثة وأحدّثك عنه.' },
    { title: 'مشروع يستحق نظرتك', body: '«{project}» في بنك المشاريع — قطاع {sector}. رصيدك يفتح لك تفاصيله الكاملة والتواصل مع مؤسسه. اسألني عنه.' },
    { title: 'موعد يقترب', body: '«{event}» يوم {eventDate} — حضورك مشمول بعضويتك، في المقر أو أونلاين. اسألني عن التفاصيل.' },
    { title: 'فرصتك تنتظر', body: 'العلاقات هي رأس مالك الحقيقي — اسألني اليوم عن فرص الشراكة التي تناسبك.' },
  ],
  entrepreneur: [
    { title: 'اعرض مشروعك على المستثمرين', body: 'سجّل مشروعك في «شركاء النجاح» — تقييم خلال 10 أيام عمل ثم يُعرض على أعضاء النادي. افتح المحادثة وأرافقك خطوة بخطوة.' },
    { title: 'موعد يقترب', body: '«{event}» يوم {eventDate} — فرصة تلتقي فيها بالمستثمرين وجهًا لوجه. اسألني عن التفاصيل.' },
    { title: 'مشروعك يستحق منصة', body: 'مسرح النادي وبودكاست الملتقى واستوديو مجهّز — كلها بخصم 50% لعرض قصتك. اسألني كيف تبدأ.' },
  ],
  neutral: [
    { title: 'مكانك محجوز معنا', body: '«{event}» يوم {eventDate} — احضر وتعرّف على رواد الأعمال والمستثمرين عن قرب. اسألني عن التفاصيل.' },
    { title: 'نافذة على المشاريع', body: 'تصفّح «{project}» وغيره في بنك المشاريع — تشاهد ما يبنيه رواد الأعمال قبل أن تختار مسارك. اسألني عنه.' },
    { title: 'قصتك تستحق أن تُروى', body: 'مبادرة «شخصية ومسيرة» تعرّف الأعضاء بك بدون رسوم، ولو قبل مشروعك الأول. اسألني كيف تقدّم.' },
  ],
};

/** The last resort when every template of a pool needs data the day does not have. */
const GENERIC: CompanionTemplate = { title: 'مستشارك معك', body: 'افتح المحادثة وأرشّح لك خطوة اليوم.' };

type Deps = {
  kv: KV;
  log: FastifyBaseLogger;
  config: Config;
  push: PushService;
  projects: ProjectsService;
  agenda: AgendaService;
};

type Draft = { title: string; body: string };
type Context = Record<string, string | null>;

/** Fills {placeholders}; null when the day has no data for one of them. */
function fill(template: CompanionTemplate, context: Context): Draft | null {
  let missing = false;
  const replace = (text: string): string =>
    text.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
      const value = context[key];
      if (value == null) {
        missing = true;
        return match;
      }
      return value;
    });
  const title = replace(template.title);
  const body = replace(template.body);
  return missing ? null : { title, body };
}

export class CompanionService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.deps.config.COMPANION_PUSH !== '1') return;
    this.timer = setInterval(() => void this.tick().catch((error) => this.deps.log.warn({ err: error }, 'companion tick failed')), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── templates (M87b: owner-editable from the dashboard) ───────────────────

  /** The pools the waves draw from: the owner's saved ones, or the seed. */
  async templates(): Promise<{ templates: CompanionTemplates; edited: boolean }> {
    const saved = await this.deps.kv.get<CompanionTemplates>(TEMPLATES_KEY);
    if (saved && COMPANION_PERSONAS.every((persona) => Array.isArray(saved[persona]) && saved[persona].length > 0)) {
      return { templates: saved, edited: true };
    }
    return { templates: COMPANION_SEED, edited: false };
  }

  async saveTemplates(templates: CompanionTemplates): Promise<void> {
    await this.deps.kv.set(TEMPLATES_KEY, templates);
  }

  /** «استرجاع النصوص الأصلية»: back to the seed pools. */
  async resetTemplates(): Promise<void> {
    await this.deps.kv.delete(TEMPLATES_KEY);
  }

  // ── mute (M87b: per-member opt-out) ────────────────────────────────────────

  private async mutedList(): Promise<number[]> {
    return (await this.deps.kv.get<{ ids: number[] }>(MUTED_KEY))?.ids ?? [];
  }

  async isMuted(contactId: number): Promise<boolean> {
    return (await this.mutedList()).includes(contactId);
  }

  async setMuted(contactId: number, muted: boolean): Promise<boolean> {
    const ids = new Set(await this.mutedList());
    if (muted) ids.add(contactId);
    else ids.delete(contactId);
    await this.deps.kv.set(MUTED_KEY, { ids: [...ids] });
    return muted;
  }

  async mutedCount(): Promise<number> {
    return (await this.mutedList()).length;
  }

  /** For the dashboard card. */
  async status(): Promise<{ enabled: boolean; lastDay: string | null; mutedCount: number }> {
    const sent = await this.deps.kv.get<{ day: string }>(SENT_KEY);
    return { enabled: this.deps.config.COMPANION_PUSH === '1', lastDay: sent?.day ?? null, mutedCount: await this.mutedCount() };
  }

  // ── the daily wave ─────────────────────────────────────────────────────────

  /** Sends today's three persona messages once, inside the send hour; safe to call any time. */
  async tick(now = Date.now()): Promise<boolean> {
    if (riyadhHour(now) !== SEND_HOUR) return false;
    const today = riyadhDay(now);
    const sent = await this.deps.kv.get<{ day: string }>(SENT_KEY);
    if (sent?.day === today) return false;
    // The mark lands BEFORE the sends: a crash mid-way never double-messages the members.
    await this.deps.kv.set(SENT_KEY, { day: today });
    const drafts = await this.drafts(now);
    // M87b: members who muted the daily message are skipped, one set for the three waves.
    const muted = new Set(await this.mutedList());
    for (const [persona, draft] of Object.entries(drafts)) {
      const outcome = await this.deps.push.broadcastPersona(persona, { title: draft.title, body: draft.body, data: { screen: '/advisor', type: 'companion' } }, muted);
      this.deps.log.info({ persona, ...outcome }, 'companion daily push');
    }
    return true;
  }

  /** Today's three messages — the day's template, filled from live data; a template missing its data falls to the next. */
  async drafts(now = Date.now()): Promise<Record<CompanionPersona, Draft>> {
    const index = dayIndex(now);
    const golden = await getGoldenContent(this.deps.kv);
    const goldenPick = golden.companies.length ? golden.companies[index % golden.companies.length] : null;
    const bank = this.deps.projects.list({ sort: 'discover', page: 1, limit: 12 });
    const bankPick = bank.items.length ? bank.items[index % bank.items.length] : null;
    const nextEvent = (await this.deps.agenda.forViewer(null, 'ar', now)).find((event) => !event.past) ?? null;

    const context: Context = {
      golden: goldenPick?.name ?? null,
      project: bankPick?.title ?? null,
      sector: bankPick?.sector?.name ?? null,
      event: nextEvent?.title ?? null,
      eventDate: nextEvent?.date ?? null,
    };

    const { templates } = await this.templates();
    const pick = (pool: CompanionTemplate[]): Draft => {
      for (let offset = 0; offset < pool.length; offset += 1) {
        const template = pool[(index + offset) % pool.length];
        const filled = template ? fill(template, context) : null;
        if (filled) return filled;
      }
      return { ...GENERIC };
    };
    return { investor: pick(templates.investor), entrepreneur: pick(templates.entrepreneur), neutral: pick(templates.neutral) };
  }
}
