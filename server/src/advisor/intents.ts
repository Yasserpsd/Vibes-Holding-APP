import type { FastifyBaseLogger } from 'fastify';

import type { Me } from '../auth/service.js';
import { getServicesContent, publicServices } from '../content/services.js';
import { HQ_SPACE_LABELS, bookableDays, slotTimes, type HqService, type HqSpace } from '../hq/service.js';
import type { AppLang } from '../lang.js';
import type { FetchImpl } from '../news/rss.js';
import type { KV } from '../store.js';
import { asciiDigits, snapOption } from './fill.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 30_000;
/** M261: how many bookable days ahead the advisor looks for the nearest available appointment to suggest. */
const SUGGEST_DAYS = 7;

/** Screens the app can open from a chat button (expo-router paths live in the app, keys live here). */
export const APP_SCREENS = [
  'home',
  'projects',
  'golden',
  'membership',
  'services',
  'hq',
  'news',
  'videos',
  'posts',
  'account',
  'card',
  'invite',
  'agenda',
  'people',
  'people_apply',
  'guide',
  'workshops',
  'meetups',
  'payments',
  'profile',
  'security',
  'about',
] as const;
/**
 * M268: screens added AFTER builds were in the stores. An installed build pushes whatever route its own table gives
 * for a key, so a key it does not know must never reach it: the app names the extra keys it knows in the request
 * (`screens`), and only those are offered to the model.
 */
export const EXTRA_SCREENS = ['partners', 'markets'] as const;
export type ExtraScreen = (typeof EXTRA_SCREENS)[number];
export type AppScreen = (typeof APP_SCREENS)[number] | ExtraScreen;

export const SCREEN_LABELS: Record<AppScreen, { ar: string; en: string; hint: string }> = {
  home: { ar: 'الرئيسية', en: 'Home', hint: 'home / start' },
  projects: { ar: 'بنك المشاريع', en: 'Projects Bank', hint: 'browse investment projects, startups, partnerships' },
  golden: { ar: 'المشاريع الذهبية', en: 'Golden projects', hint: 'golden companies, golden opportunity' },
  membership: { ar: 'العضوية', en: 'Membership', hint: 'subscribe, renew, benefits, price' },
  services: { ar: 'خدمات النادي', en: 'Club services', hint: 'all services list' },
  hq: { ar: 'مقر النادي', en: 'Club HQ', hint: 'HQ info, my visits, passes, hours wallet' },
  news: { ar: 'الأخبار', en: 'News', hint: 'business news, decisions' },
  videos: { ar: 'الفيديوهات', en: 'Videos', hint: 'films, channel' },
  posts: { ar: 'رسائل الإدارة', en: 'Management posts', hint: 'announcements, polls' },
  account: { ar: 'حسابي', en: 'My account', hint: 'account menu' },
  card: { ar: 'بطاقة العضوية', en: 'Membership card', hint: 'card, QR, print/deliver the card' },
  invite: { ar: 'دعوة عضو جديد', en: 'Invite a member', hint: 'invite code, referral' },
  agenda: { ar: 'الأجندة', en: 'Agenda', hint: 'events, tickets' },
  people: { ar: 'شخصية ومسيرة', en: 'People and career', hint: 'the personal spotlight: featured members and their careers — NOT projects, NOT success partners' },
  // M268: this key opens /people/apply — the «شخصية ومسيرة» application. It was labelled «التقديم في شركاء النجاح», so
  // «افتح شركاء النجاح» opened the wrong screen (owner, 2026-11-22). Success Partners is a SERVICE (success-partners).
  people_apply: { ar: 'التقديم في «شخصية ومسيرة»', en: 'Apply to People and career', hint: 'apply to be featured personally in the people spotlight — NOT a project registration, NOT success partners' },
  guide: { ar: 'دليل العضو', en: 'Member guide', hint: 'guide' },
  workshops: { ar: 'ورش العمل', en: 'Workshops', hint: 'workshops registration' },
  meetups: { ar: 'الملتقيات', en: 'Meetups', hint: 'meetups' },
  payments: { ar: 'مدفوعاتي', en: 'My payments', hint: 'invoices, payments history' },
  profile: { ar: 'تعديل الملف الشخصي', en: 'Edit profile', hint: 'change name, company, bio' },
  security: { ar: 'الأمان', en: 'Security', hint: 'password, app lock, two-factor' },
  about: { ar: 'عن النادي', en: 'About the club', hint: 'about, contact management' },
  partners: { ar: 'شركاؤنا', en: 'Our partners', hint: 'partner discounts, offers and the member promo code — NOT success partners' },
  markets: { ar: 'مؤشرات السوق', en: 'Markets', hint: 'gold price, currencies, market indicators' },
};

export type HqKind = 'visit' | HqSpace;
export type HqProposal = {
  kind: HqKind;
  hours: number;
  date: string | null;
  time: string | null;
  purpose: string | null;
  note: string;
};
export type HqProposalOptions = {
  kinds: { key: HqKind; label: string }[];
  days: { date: string; label: string }[];
  /** Free slots for the chosen day (all slot times when no day yet). */
  times: string[];
  purposes: string[];
  hours: number[];
};
export type IntentAction =
  | { type: 'hq_book'; proposal: HqProposal; missing: ('date' | 'time' | 'purpose')[]; options: HqProposalOptions; summary: string[] }
  | { type: 'screen'; screen: AppScreen; label: string }
  | { type: 'service'; key: string; title: string; answers: Record<string, string>; label: string };
export type IntentResult = { action: IntentAction | null; reply: string | null };

export type IntentInput = {
  text: string;
  lang: AppLang;
  me: Me;
  /** The hq_book proposal the member is still completing (the app sends it back). */
  pending?: HqProposal | null;
  /** M268: the EXTRA_SCREENS keys this app build can open; an older build sends none. */
  extraScreens?: ExtraScreen[];
  now?: number;
};

/** One service as the intent model reads it: what it is, and the request fields it can prefill (none for a form, a screen or a link). */
type CatalogService = { key: string; title: string; summary: string; fields: { key: string; label: string; options?: string[] }[] };

type Deps = { apiKey: string; model: string; log: FastifyBaseLogger; fetchImpl?: FetchImpl; hq: HqService; kv: KV };

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'app_intent',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['none', 'hq_book', 'open_screen', 'service'] },
        screen: { type: 'string' },
        serviceKey: { type: 'string' },
        answers: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'], additionalProperties: false } },
        hq: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['', 'visit', 'office', 'meeting'] },
            hours: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string' },
            purpose: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['kind', 'hours', 'date', 'time', 'purpose', 'note'],
          additionalProperties: false,
        },
        reply: { type: 'string' },
      },
      required: ['intent', 'screen', 'serviceKey', 'answers', 'hq', 'reply'],
      additionalProperties: false,
    },
  },
};

type ModelAnswer = {
  intent: 'none' | 'hq_book' | 'open_screen' | 'service';
  screen: string;
  serviceKey: string;
  answers: { key: string; value: string }[];
  hq: { kind: '' | HqKind; hours: string; date: string; time: string; purpose: string; note: string };
  reply: string;
};

function dayLabel(date: string, lang: AppLang): string {
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(when);
}

function kindLabel(kind: HqKind, lang: AppLang): string {
  if (kind === 'visit') return lang === 'en' ? 'HQ visit' : 'زيارة المقر';
  if (kind === 'office') return lang === 'en' ? 'Private office' : HQ_SPACE_LABELS.office;
  return lang === 'en' ? 'Meeting room' : 'قاعة الاجتماعات';
}

/**
 * M145 «المساعد ينفّذ»: the member's chat line is read for an APP intent before it reaches the hub.
 * Three intents for now — book the HQ (visit / office / meeting room) with a confirm card,
 * open a screen, or open a service request with the fields prefilled. Everything the model
 * returns is validated against the live catalog (days, free slots, purposes, services) and the
 * member still confirms in the app with his own session; the server never books on its own.
 */
export class IntentDetector {
  constructor(private readonly deps: Deps) {}

  async detect(input: IntentInput): Promise<IntentResult> {
    const now = input.now ?? Date.now();
    const lang = input.lang;
    const content = await this.deps.hq.content();
    const days = bookableDays(content, now);
    const times = slotTimes(content);
    // M268 (owner, 2026-11-22: «طلبت منه اني عايز انشر مشروعي في بنك المشاريع مفهمش… ولا فتحلي شركاء النجاح»): the
    // catalog used to hold only the services with a WhatsApp / payment request, so Success Partners (a form), the app
    // publishing and every other service could not be opened at all. Every service is listed now, with its summary so
    // the model knows what it is for; only the request ones carry fields to prefill. A locked service still opens its page.
    const catalog: CatalogService[] = publicServices(await getServicesContent(this.deps.kv, lang), input.me).services.map((service) => ({
      key: service.key,
      title: service.title,
      summary: service.summary,
      fields: service.action && (service.action.type === 'whatsapp' || service.action.type === 'paymob') ? service.action.fields : [],
    }));
    const screens: AppScreen[] = [...APP_SCREENS, ...EXTRA_SCREENS.filter((key) => input.extraScreens?.includes(key))];
    const text = input.text.trim();
    // The purposes as the member reads them: the card's chips and its «الغرض» line were Arabic in the English app.
    // The booking itself accepts either language (HqService.book stores the Arabic one).
    const purposes = lang === 'en' ? (await this.deps.hq.content('en')).purposes : content.purposes;

    // A bare pick from the card (no new words): complete the pending proposal without the model.
    if (!text && input.pending) {
      return this.hqResult(input.pending, lang, days, times, purposes, now, null);
    }

    const answer = await this.ask(input, days, times, purposes, catalog, screens);
    if (!answer) return { action: null, reply: null };

    if (answer.intent === 'hq_book' || (input.pending && answer.intent === 'none' && this.hqTouched(answer))) {
      const base: HqProposal = input.pending ?? { kind: 'visit', hours: 1, date: null, time: null, purpose: null, note: '' };
      const kind: HqKind = answer.hq.kind || base.kind;
      const hoursN = Number(asciiDigits(answer.hq.hours));
      const proposal: HqProposal = {
        kind,
        hours: kind === 'visit' ? 1 : Number.isInteger(hoursN) && hoursN >= 1 && hoursN <= 12 ? hoursN : base.hours,
        date: this.pickDate(answer.hq.date, days) ?? base.date,
        time: this.pickTime(answer.hq.time, times) ?? base.time,
        purpose: kind === 'visit' ? snapOption(answer.hq.purpose, purposes) || base.purpose : null,
        note: answer.hq.note.trim().slice(0, 300) || base.note,
      };
      return this.hqResult(proposal, lang, days, times, purposes, now, answer.reply.trim() || null);
    }

    // M268, tried on the live model: «افتح شركاء النجاح» came back as "open_screen" naming the SERVICE (there is no
    // such screen), and the action was dropped. «افتح …» is how members ask for a service too, so a key the model
    // put in the wrong slot is still honoured: a screen answer that names a service opens the service, and the reverse.
    const wantsScreen = answer.intent === 'open_screen';
    const wantsService = answer.intent === 'service';
    const namedScreen = screens.find((key) => key === answer.screen) ?? (wantsService ? screens.find((key) => key === answer.serviceKey) : undefined);
    const namedService = catalog.find((item) => item.key === answer.serviceKey) ?? (wantsScreen ? catalog.find((item) => item.key === answer.screen) : undefined);

    if ((wantsScreen && namedScreen) || (wantsService && !namedService && namedScreen)) {
      const screen = namedScreen;
      const label = SCREEN_LABELS[screen][lang];
      return { action: { type: 'screen', screen, label }, reply: answer.reply.trim() || (lang === 'en' ? `Here is ${label}.` : `تفضل، ${label}:`) };
    }

    if (wantsScreen || wantsService) {
      const service = namedService;
      if (!service) return { action: null, reply: null };
      const fields = service.fields;
      const answers: Record<string, string> = {};
      for (const { key, value } of answer.answers) {
        const field = fields.find((item) => item.key === key);
        if (!field || !value.trim()) continue;
        answers[key] = field.options?.length ? snapOption(value, field.options) : value.trim().slice(0, 500);
      }
      const label = lang === 'en' ? `Open: ${service.title}` : `افتح: ${service.title}`;
      return {
        action: { type: 'service', key: service.key, title: service.title, answers, label },
        reply:
          answer.reply.trim() ||
          (fields.length
            ? lang === 'en'
              ? 'I prepared the request; review it and send.'
              : 'جهّزت لك الطلب، راجعه وأرسله.'
            : lang === 'en'
              ? `Here is ${service.title}.`
              : `تفضل، ${service.title}:`),
      };
    }

    return { action: null, reply: null };
  }

  private hqTouched(answer: ModelAnswer): boolean {
    return Boolean(answer.hq.kind || answer.hq.date || answer.hq.time || answer.hq.purpose || answer.hq.hours || answer.hq.note);
  }

  private pickDate(value: string, days: { date: string }[]): string | null {
    const m = asciiDigits(value).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    const date = `${m[1]}-${(m[2] ?? '').padStart(2, '0')}-${(m[3] ?? '').padStart(2, '0')}`;
    return days.some((day) => day.date === date) ? date : null;
  }

  private pickTime(value: string, times: string[]): string | null {
    const m = asciiDigits(value).match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const time = `${(m[1] ?? '').padStart(2, '0')}:${m[2]}`;
    return times.includes(time) ? time : null;
  }

  private async hqResult(
    proposal: HqProposal,
    lang: AppLang,
    days: { date: string }[],
    allTimes: string[],
    purposes: string[],
    now: number,
    modelReply: string | null,
  ): Promise<IntentResult> {
    const space: HqSpace | null = proposal.kind === 'visit' ? null : proposal.kind;
    const freeOn = async (date: string): Promise<string[]> => {
      try {
        const { slots } = await this.deps.hq.slots(date, now, { space, hours: proposal.hours });
        return slots.filter((slot) => slot.available).map((slot) => slot.time);
      } catch {
        return [];
      }
    };
    // M261 (owner, 2026-11-22: «يقترح عليا مواعيد… ناقص ادوس بس»): whatever the member left out is SUGGESTED, not
    // asked — the nearest bookable day with a free slot (the hour he named when it is free there, the day's first
    // free hour otherwise), so the card arrives complete and one tap confirms. Every chip still changes it.
    let times = allTimes;
    let suggested = false;
    if (proposal.date) {
      times = await freeOn(proposal.date);
      const wanted = proposal.time;
      if (wanted && !times.includes(wanted)) proposal = { ...proposal, time: null };
      // A named hour that is taken stays an open question (the member sees it is gone); only a silent hour is filled.
      if (!wanted && times[0]) {
        proposal = { ...proposal, time: times[0] };
        suggested = true;
      }
    } else {
      const window: { date: string; free: string[] }[] = [];
      for (const day of days.slice(0, SUGGEST_DAYS)) {
        const free = await freeOn(day.date);
        if (free.length) window.push({ date: day.date, free });
      }
      const wanted = proposal.time;
      const match = (wanted ? window.find((day) => day.free.includes(wanted)) : undefined) ?? window[0];
      if (match) {
        proposal = { ...proposal, date: match.date, time: wanted && match.free.includes(wanted) ? wanted : (match.free[0] ?? null) };
        times = match.free;
        suggested = true;
      }
    }
    const missing: ('date' | 'time' | 'purpose')[] = [];
    if (!proposal.date) missing.push('date');
    if (!proposal.time) missing.push('time');
    if (proposal.kind === 'visit' && !proposal.purpose) missing.push('purpose');

    const en = lang === 'en';
    // The Arabic counted noun: «ساعة واحدة»، «ساعتان»، «5 ساعات»، «12 ساعة» (it read «2 ساعتان» and «12 ساعات»).
    const hours = proposal.hours;
    const duration = en
      ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
      : hours === 1
        ? 'ساعة واحدة'
        : hours === 2
          ? 'ساعتان'
          : `${hours} ${hours <= 10 ? 'ساعات' : 'ساعة'}`;
    const summary = [
      `${en ? 'Booking' : 'الحجز'}: ${kindLabel(proposal.kind, lang)}`,
      ...(space ? [`${en ? 'Duration' : 'المدة'}: ${duration}`] : []),
      `${en ? 'Day' : 'اليوم'}: ${proposal.date ? dayLabel(proposal.date, lang) : '—'}`,
      `${en ? 'Time' : 'الوقت'}: ${proposal.time ?? '—'}`,
      ...(space ? [] : [`${en ? 'Purpose' : 'الغرض'}: ${proposal.purpose ?? '—'}`]),
      ...(proposal.note ? [`${en ? 'Note' : 'ملاحظة'}: ${proposal.note}`] : []),
    ];
    const askFor = missing
      .map((key) => (key === 'date' ? (en ? 'the day' : 'اليوم') : key === 'time' ? (en ? 'the time' : 'الوقت') : en ? 'the purpose' : 'الغرض'))
      .join(en ? ' and ' : ' و');
    const fallback = missing.length
      ? en
        ? `Almost there — pick ${askFor} below.`
        : `بقي تحديد ${askFor}: اختر من الخيارات ليكتمل الحجز.`
      : en
        ? 'Ready — review the booking and confirm.'
        : 'جاهز، راجع الحجز واضغط تأكيد.';
    // A suggested appointment is always named in the server's own words: the model wrote its line before the
    // suggestion existed (it may still be asking for the day).
    const when = proposal.date && proposal.time ? `${dayLabel(proposal.date, lang)} ${en ? 'at' : 'الساعة'} ${proposal.time}` : '';
    const suggestion = !suggested || !when
      ? null
      : missing.length
        ? en
          ? `I suggest the nearest available appointment: ${when}. Pick ${askFor} below and the booking is ready.`
          : `أقترح عليك أقرب موعد متاح: ${when}. اختر ${askFor} من الخيارات ليكتمل الحجز.`
        : en
          ? `I prepared the booking on the nearest available appointment: ${when}. Tap confirm, or change the day or the time below.`
          : `جهّزت لك الحجز على أقرب موعد متاح: ${when}. اضغط «تأكيد الحجز»، أو غيّر اليوم أو الوقت من الخيارات.`;
    return {
      action: {
        type: 'hq_book',
        proposal,
        missing,
        options: {
          kinds: (['visit', 'office', 'meeting'] as HqKind[]).map((key) => ({ key, label: kindLabel(key, lang) })),
          days: days.map((day) => ({ date: day.date, label: dayLabel(day.date, lang) })),
          times,
          purposes,
          hours: Array.from({ length: 12 }, (_, index) => index + 1),
        },
        summary,
      },
      reply: suggestion ?? modelReply ?? fallback,
    };
  }

  private async ask(
    input: IntentInput,
    days: { date: string; weekday: number }[],
    times: string[],
    purposes: string[],
    catalog: CatalogService[],
    screens: AppScreen[],
  ): Promise<ModelAnswer | null> {
    const lang = input.lang;
    const today = days[0]?.date ?? new Date(input.now ?? Date.now()).toISOString().slice(0, 10);
    const system = [
      'You route one chat message from a member of a Saudi business club app. Decide whether it asks the APP to DO something, and extract the details. The member writes Arabic (any dialect) or English.',
      'intents: "hq_book" = book a visit to the club HQ, a private office, or the meeting room (also when the member only adds a missing detail to a pending booking); "open_screen" = the member asks to see/open/go to a section of the app; "service" = the member asks for one of the listed club services and the request can be prefilled; "none" = a question, small talk, advice, anything else (the human-like advisor answers those).',
      'Never invent details. Unknown → "". Dates → YYYY-MM-DD from the bookable days list only (resolve "tomorrow", weekday names, "next Thursday" against today). Times → HH:MM from the slot list only (convert "10 in the morning"/"4 pm"). hours → digits (office/meeting only). purpose → copy one of the listed purposes verbatim (visits only). kind: visit | office | meeting.',
      `reply: one short, warm sentence in ${lang === 'en' ? 'English' : 'Arabic (Saudi white dialect, no diacritics)'}: confirm what you understood and, if something is missing, ask for it; for "none" leave it "".`,
      'Pending booking (if given) is what the member is completing: keep its details and fill only what this message adds.',
      // M268: the two mix-ups the owner hit — «أنشر مشروعي في بنك المشاريع» understood as nothing, «افتح شركاء النجاح» opening the people spotlight.
      'Pick by MEANING, never by a shared word. A service named or described by the member → "service" with its key, even when it has no fields (answers stay []) and even when the member only says open / show / go to it («افتح شركاء النجاح» → "service", serviceKey "success-partners"): "open_screen" is ONLY for the keys in the Screens list. The member’s OWN project / startup / company / idea to be registered, submitted, listed, published or shown to investors or partners (including "publish my project in the Projects Bank", "شركاء النجاح", "success partners") → "service" with key "success-partners" when it is listed; the "projects" screen only BROWSES other people’s projects. The screens "people" and "people_apply" are the personal spotlight «شخصية ومسيرة» and never a project. «شركاؤنا» / partner discounts is not «شركاء النجاح».',
    ].join('\n');
    const pending = input.pending
      ? `\nPending booking: ${JSON.stringify({ kind: input.pending.kind, hours: input.pending.hours, date: input.pending.date, time: input.pending.time, purpose: input.pending.purpose, note: input.pending.note })}`
      : '';
    const user = [
      `Today (Riyadh): ${today}`,
      `Bookable days: ${days.map((day) => `${day.date} (${dayLabel(day.date, 'en')})`).join(', ')}`,
      `Slot times: ${times.join(', ')}`,
      `Visit purposes: ${purposes.map((purpose) => JSON.stringify(purpose)).join(' | ')}`,
      `Screens: ${screens.map((key) => `${key} = ${SCREEN_LABELS[key].ar} (${SCREEN_LABELS[key].hint})`).join('; ')}`,
      `Services: ${catalog.map((service) => `${service.key} = "${service.title}" (${service.summary.slice(0, 110)}) fields[${service.fields.map((field) => `${field.key}:"${field.label}"${field.options?.length ? `{${field.options.join('|')}}` : ''}`).join(', ')}]`).join('; ') || 'none'}`,
      pending,
      `\nMessage:\n"""${input.text.trim().slice(0, 2000)}"""`,
    ].join('\n');
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.deps.apiKey}` },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0,
        response_format: RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      this.deps.log.warn({ status: response.status }, 'intent detection failed');
      return null;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    try {
      const parsed = JSON.parse(content) as Partial<ModelAnswer>;
      if (!parsed || typeof parsed !== 'object' || !parsed.intent) return null;
      return {
        intent: parsed.intent,
        screen: typeof parsed.screen === 'string' ? parsed.screen : '',
        serviceKey: typeof parsed.serviceKey === 'string' ? parsed.serviceKey : '',
        answers: Array.isArray(parsed.answers) ? parsed.answers.filter((item) => item && typeof item.key === 'string' && typeof item.value === 'string') : [],
        hq: {
          kind: parsed.hq?.kind === 'visit' || parsed.hq?.kind === 'office' || parsed.hq?.kind === 'meeting' ? parsed.hq.kind : '',
          hours: String(parsed.hq?.hours ?? ''),
          date: String(parsed.hq?.date ?? ''),
          time: String(parsed.hq?.time ?? ''),
          purpose: String(parsed.hq?.purpose ?? ''),
          note: String(parsed.hq?.note ?? ''),
        },
        reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      };
    } catch {
      return null;
    }
  }
}
