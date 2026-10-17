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
 * M60's lesson is kept: one message a day at a human hour, COMPANION_PUSH=0 kills it cold.
 */

const SENT_KEY = 'companion:lastDay';
const TICK_MS = 10 * 60_000;
/** The push goes out in this Riyadh hour (11:00–11:59) — mid-morning, never at night. */
const SEND_HOUR = 11;

const riyadhHour = (now: number): number => new Date(now + 3 * 3_600_000).getUTCHours();
/** A stable daily index for the rotations: the day number, Riyadh calendar. */
const dayIndex = (now: number): number => Math.floor((now + 3 * 3_600_000) / 86_400_000);

type Deps = {
  kv: KV;
  log: FastifyBaseLogger;
  config: Config;
  push: PushService;
  projects: ProjectsService;
  agenda: AgendaService;
};

type Draft = { title: string; body: string };

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

  /** Sends today's three persona messages once, inside the send hour; safe to call any time. */
  async tick(now = Date.now()): Promise<boolean> {
    if (riyadhHour(now) !== SEND_HOUR) return false;
    const today = riyadhDay(now);
    const sent = await this.deps.kv.get<{ day: string }>(SENT_KEY);
    if (sent?.day === today) return false;
    // The mark lands BEFORE the sends: a crash mid-way never double-messages the members.
    await this.deps.kv.set(SENT_KEY, { day: today });
    const drafts = await this.drafts(now);
    for (const [persona, draft] of Object.entries(drafts)) {
      const outcome = await this.deps.push.broadcastPersona(persona, { title: draft.title, body: draft.body, data: { screen: '/advisor', type: 'companion' } });
      this.deps.log.info({ persona, ...outcome }, 'companion daily push');
    }
    return true;
  }

  /** Today's three messages, filled from live data; exported for the tests and a future dashboard preview. */
  async drafts(now = Date.now()): Promise<Record<'investor' | 'entrepreneur' | 'neutral', Draft>> {
    const index = dayIndex(now);
    const golden = await getGoldenContent(this.deps.kv);
    const goldenPick = golden.companies.length ? golden.companies[index % golden.companies.length] : null;
    const bank = this.deps.projects.list({ sort: 'discover', page: 1, limit: 12 });
    const bankPick = bank.items.length ? bank.items[index % bank.items.length] : null;
    const nextEvent = (await this.deps.agenda.forViewer(null, 'ar', now)).find((event) => !event.past) ?? null;

    const investor: Draft[] = [
      goldenPick
        ? {
            title: 'ترشيح اليوم من مستشارك',
            body: `ألقِ نظرة على «${goldenPick.name}» من المشاريع الذهبية — تواصلك مع أي مشروع ذهبي لا يخصم من رصيدك. افتح المحادثة وأحدّثك عنه.`,
          }
        : { title: 'مستشارك معك', body: 'رصيدك في بنك المشاريع يفتح لك التفاصيل الكاملة والتواصل المباشر مع المؤسسين. افتح المحادثة وأرشّح لك مشروعًا اليوم.' },
      bankPick
        ? {
            title: 'مشروع يستحق نظرتك',
            body: `«${bankPick.title}» في بنك المشاريع${bankPick.sector ? ` — قطاع ${bankPick.sector.name}` : ''}. رصيدك يفتح لك تفاصيله الكاملة والتواصل مع مؤسسه. اسألني عنه.`,
          }
        : { title: 'مستشارك معك', body: 'أكثر من 260 مشروعًا اجتازت الفحص في بنك المشاريع. افتح المحادثة وأرشّح لك ما يناسب اهتمامك.' },
      nextEvent
        ? { title: 'موعد يقترب', body: `«${nextEvent.title}» يوم ${nextEvent.date} — حضورك مشمول بعضويتك، في المقر أو أونلاين. اسألني عن التفاصيل.` }
        : { title: 'فرصتك تنتظر', body: 'العلاقات هي رأس مالك الحقيقي — اسألني اليوم عن فرص الشراكة التي تناسبك.' },
    ];
    const entrepreneur: Draft[] = [
      { title: 'اعرض مشروعك على المستثمرين', body: 'سجّل مشروعك في «شركاء النجاح» — تقييم خلال 10 أيام عمل ثم يُعرض على أعضاء النادي. افتح المحادثة وأرافقك خطوة بخطوة.' },
      nextEvent
        ? { title: 'موعد يقترب', body: `«${nextEvent.title}» يوم ${nextEvent.date} — فرصة تلتقي فيها بالمستثمرين وجهًا لوجه. اسألني عن التفاصيل.` }
        : { title: 'مستشارك معك', body: 'ملتقى باسمك، عرض تقديمي احترافي، وخدمات بخصم 50% للأعضاء. افتح المحادثة وأرتّب لك الخطوة القادمة.' },
      { title: 'مشروعك يستحق منصة', body: 'مسرح النادي وبودكاست الملتقى واستوديو مجهّز — كلها بخصم 50% لعرض قصتك. اسألني كيف تبدأ.' },
    ];
    const neutral: Draft[] = [
      nextEvent
        ? { title: 'مكانك محجوز معنا', body: `«${nextEvent.title}» يوم ${nextEvent.date} — احضر وتعرّف على رواد الأعمال والمستثمرين عن قرب. اسألني عن التفاصيل.` }
        : { title: 'استكشف النادي', body: 'ملتقيات وورش عمل على مدار السنة تساعدك تحدد وجهتك. افتح المحادثة وأرشّح لك البداية.' },
      bankPick
        ? { title: 'نافذة على المشاريع', body: `تصفّح «${bankPick.title}» وغيره في بنك المشاريع — تشاهد ما يبنيه رواد الأعمال قبل أن تختار مسارك. اسألني عنه.` }
        : { title: 'مستشارك معك', body: 'لم تحدد وجهتك بعد؟ هذا طبيعي تمامًا — افتح المحادثة وسأساعدك تستكشف بهدوء.' },
      { title: 'قصتك تستحق أن تُروى', body: 'مبادرة «شخصية ومسيرة» تعرّف الأعضاء بك بدون رسوم، ولو قبل مشروعك الأول. اسألني كيف تقدّم.' },
    ];

    // The pools above are literal and never empty; the fallback only satisfies the type.
    const pick = (pool: Draft[]): Draft => pool[index % pool.length] ?? { title: 'مستشارك معك', body: 'افتح المحادثة وأرشّح لك خطوة اليوم.' };
    return { investor: pick(investor), entrepreneur: pick(entrepreneur), neutral: pick(neutral) };
  }
}
