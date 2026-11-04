import type { FastifyBaseLogger } from 'fastify';

import type { AffiliateService } from '../affiliate/service.js';
import type { AuthService } from '../auth/service.js';
import type { SessionRecord } from '../auth/sessions.js';
import type { FetchImpl } from '../news/rss.js';
import type { ProjectAccessService } from '../projectsBank/access.js';
import { kindLabel, statusLabel } from '../requests/model.js';
import type { RequestsService } from '../requests/service.js';
import type { AdvisorContext } from './context.js';

/**
 * M183 «الوعي اللحظي»: what the member is actually doing in the app, read live at message time and
 * handed to the brain inside the context — his latest operations (bookings, orders, registrations,
 * payments, from the same timeline «متابعة طلباتي» shows him), his Projects Bank balance when the
 * question is about the bank, and the exact unlock state of the project he is looking at. Facts the
 * member already sees about himself, never another member's data and never founder contact values.
 */
export type Presence = { block: string; deckUrl: string | null; deckName: string | null };
export const NO_PRESENCE: Presence = { block: '', deckUrl: null, deckName: null };

/** The heading the brain's prompt names: keep the wording in sync with the n8n prompt. */
export const PRESENCE_HEADER = '═ نشاط العضو في التطبيق (حي من السيرفر الآن؛ حقائق تُبنى عليها ولا يُسأل عنها) ═';
export const PRESENCE_MAX = 1400;
const TIMELINE_ROWS = 5;

/** The member asks about the deck itself: only then the PDF rides along. */
export const DECK_RE = /pitch\s*-?\s*deck|بيتش|العرض\s+التقديمي|الملف\s+التعريفي|ملف\s+العرض|\bdeck\b/i;

export const DECK_MAX_BYTES = 10 * 1024 * 1024;
const DECK_TIMEOUT_MS = 25_000;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

type Deps = {
  auth: AuthService;
  requests?: RequestsService;
  access?: ProjectAccessService;
  /** M194: the affiliate standing (approved affiliates only). */
  affiliate?: Pick<AffiliateService, 'find' | 'balance'>;
  log: FastifyBaseLogger;
};

export class MemberPresence {
  constructor(private readonly deps: Deps) {}

  /** Never throws: a failing source costs its line, not the message. */
  async of(session: SessionRecord, context: AdvisorContext | null, message: string): Promise<Presence> {
    try {
      const me = await this.deps.auth.me(session);
      if (!me) return NO_PRESENCE;
      const [timeline, project, affiliate] = await Promise.all([this.timelineLines(me.id), this.projectLines(session, context, message), this.affiliateLines(me.id)]);
      const lines = [...timeline, ...affiliate, ...project.lines];
      if (!lines.length) return { ...NO_PRESENCE, deckUrl: project.deckUrl, deckName: project.deckName };
      return { block: clip([PRESENCE_HEADER, ...lines].join('\n'), PRESENCE_MAX), deckUrl: project.deckUrl, deckName: project.deckName };
    } catch (error) {
      this.deps.log.warn({ err: error }, 'advisor presence unavailable');
      return NO_PRESENCE;
    }
  }

  /** M194 (owner, 2026-11-04): an approved affiliate's numbers, so the advisor cheers him on and nudges him while nobody paid yet. */
  private async affiliateLines(contactId: number): Promise<string[]> {
    if (!this.deps.affiliate) return [];
    try {
      const record = await this.deps.affiliate.find(contactId);
      if (record?.status !== 'approved') return [];
      const balance = await this.deps.affiliate.balance(contactId);
      const line = `ممثل معتمد في برنامج ممثلي نادي المستثمرين: ${balance.paid} عضو دافع، ${balance.unpaid} غير دافع، الرصيد المتاح ${balance.available} ريال (عمولته الحالية ${balance.commission} ريال عن كل عضو دافع).`;
      return balance.paid === 0 ? [line, 'لم يسجّل عبره أي عضو دافع بعد: شجّعه بلطف على مشاركة رابطه الخاص من شاشة «أرباحي».'] : [line];
    } catch (error) {
      this.deps.log.warn({ err: error }, 'advisor presence affiliate failed');
      return [];
    }
  }

  private async timelineLines(contactId: number): Promise<string[]> {
    if (!this.deps.requests) return [];
    try {
      const rows = (await this.deps.requests.timeline(contactId)).slice(0, TIMELINE_ROWS);
      if (!rows.length) return ['لم يبدأ أي عملية في التطبيق بعد (لا حجوزات ولا طلبات).'];
      return [
        'آخر عملياته في التطبيق:',
        ...rows.map((row) => `• ${kindLabel(row.kind, 'ar')}: «${clip(row.title, 80)}» — ${statusLabel(row.status, 'ar')} (${row.createdAt.slice(0, 10)})`),
      ];
    } catch (error) {
      this.deps.log.warn({ err: error }, 'advisor presence timeline failed');
      return [];
    }
  }

  /** The member's standing with the project he looks at, or his wallet on the bank screen. */
  private async projectLines(session: SessionRecord, context: AdvisorContext | null, message: string): Promise<{ lines: string[]; deckUrl: string | null; deckName: string | null }> {
    const none = { lines: [] as string[], deckUrl: null, deckName: null };
    const { access } = this.deps;
    if (!access) return none;
    try {
      if (context?.type === 'screen' && context.id === 'projects') {
        const wallet = await access.wallet(session);
        if (!wallet.isMember) return { ...none, lines: ['المتحدث غير عضو: تصفح بنك المشاريع متاح له، وفتح بيانات التواصل مع المؤسسين يحتاج عضوية سنوية.'] };
        if (!wallet.balance) return none;
        return { ...none, lines: [`رصيده في بنك المشاريع: المتبقي ${wallet.balance.left} من ${wallet.balance.granted} فتحات، وفتح حتى الآن ${wallet.unlockedCount} ${wallet.unlockedCount === 1 ? 'مشروعًا' : 'مشاريع'}.`] };
      }
      if (context?.type !== 'project') return none;
      const state = await access.access(session, context.id);
      const balance = state.balance ? ` (رصيده: المتبقي ${state.balance.left} من ${state.balance.granted})` : '';
      switch (state.state) {
        case 'golden':
          return { ...none, lines: ['هذا مشروع ذهبي: تفاصيله وصفحة الشراكة متاحة بدون خصم من الرصيد.'] };
        case 'not_member':
          return { ...none, lines: ['المتحدث غير عضو: فتح بيانات التواصل مع المؤسس يحتاج عضوية سنوية مفعّلة.'] };
        case 'can_unlock':
          return { ...none, lines: [`لم يفتح هذا المشروع بعد${balance}: زر «فتح البيانات» في شاشة المشروع يخصم من رصيده فور الضغط، وبعده مباشرة تظهر له بيانات التواصل مع المؤسس وملف العرض التقديمي.`] };
        case 'exhausted':
          return { ...none, lines: [`استهلك رصيد الفتحات كاملًا${balance}: فتح مشروع جديد غير متاح له حاليًا.`] };
        case 'unlocked': {
          const hasDeck = Boolean(state.contact?.pitchUrl);
          const wantsDeck = hasDeck && DECK_RE.test(message);
          return {
            lines: [
              `فتح هذا المشروع بالفعل${balance}: التواصل المباشر مع المؤسس متاح له من شاشة المشروع${hasDeck ? '، وملف العرض التقديمي (Pitch Deck) متاح له — إن طلب تحليله هنا يصلك الملف مع الرسالة فحلّله' : ''}.`,
            ],
            deckUrl: wantsDeck && state.contact ? state.contact.pitchUrl : null,
            deckName: wantsDeck ? `pitch-deck-${context.id}.pdf` : null,
          };
        }
        default:
          return none;
      }
    } catch (error) {
      this.deps.log.warn({ err: error }, 'advisor presence project state failed');
      return none;
    }
  }
}

/** The unlocked project's deck, fetched server-side so the brain's PDF branch can read it (M151 path). */
export async function fetchDeck(url: string, name: string, fetchImpl: FetchImpl, log: FastifyBaseLogger): Promise<{ name: string; base64: string } | null> {
  try {
    const answer = await fetchImpl(url, { signal: AbortSignal.timeout(DECK_TIMEOUT_MS), redirect: 'follow' });
    if (!answer.ok) return null;
    const bytes = Buffer.from(await answer.arrayBuffer());
    if (bytes.length > DECK_MAX_BYTES || !bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return null;
    return { name, base64: bytes.toString('base64') };
  } catch (error) {
    log.warn({ err: error }, 'advisor pitch deck fetch failed');
    return null;
  }
}
