import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { guard } from '../auth/guard.js';
import { langOf, type AppLang } from '../lang.js';
import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';
import type { AgendaEvent, AgendaService } from './service.js';

/**
 * M177 (owner, 2026-11-01): «إعلان للورشة تعمله انت كل يوم بكلام من عندك… له علاقة بإسم الورشة… أول شيء… كل اللي
 * يدخل يشوف الورشة مرة في اليوم». Every Riyadh day the next open workshop gets a fresh ad — a headline, two
 * lines and a button label — written by the model from the workshop's own facts (title, dates, fee, blurb).
 * One generation per day and language for everyone (cached in kv), a fixed template when the model is
 * unavailable. The app shows it once a day as the opening popup. No promised results, never «مجاني».
 */
const KEY = 'agenda:workshopAd';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 20_000;

export type WorkshopAdCopy = { headline: string; body: string; cta: string };
export type WorkshopAd = WorkshopAdCopy & {
  eventId: string;
  title: string;
  date: string;
  dates: string[];
  time: string;
  imageUrl: string | null;
  feeSar: number;
  memberFeeSar: number;
  day: string;
};

type Stored = { day: string; eventId: string; copies: Partial<Record<AppLang, WorkshopAdCopy>> };

type Deps = { kv: KV; log: FastifyBaseLogger; agenda: AgendaService; apiKey?: string; model: string; fetchImpl?: typeof fetch };

const copySchema = z.object({
  headline: z.string().trim().min(4).max(70),
  body: z.string().trim().min(10).max(260),
  cta: z.string().trim().min(2).max(28),
});

const SYSTEM: Record<AppLang, string> = {
  ar: 'أنت كاتب إعلانات لنادي أعمال سعودي فاخر. اكتب إعلانًا قصيرًا جذابًا ليوم واحد عن ورشة عمل، مرتبطًا بعنوان الورشة وموضوعها، بأسلوب راقٍ ومحفّز يدفع القارئ لحجز مقعده الآن. غيّر الزاوية كل يوم (الفائدة العملية، الندرة، قصة قصيرة، سؤال يلمس القارئ). القواعد: لا تعد بأرباح أو نتائج مالية، لا تخترع معلومات غير موجودة في البيانات، لا تستخدم كلمة «مجاني» ومشتقاتها (استخدم «بدون رسوم»)، لا تضع شرطة بين رقمين، لا إيموجي أكثر من واحد. أعد JSON فقط: {"headline": "عنوان حتى 60 حرفًا", "body": "سطران حتى 220 حرفًا", "cta": "نص زر حتى 24 حرفًا"}.',
  en: 'You write ads for a premium Saudi business club. Write a short, compelling one-day ad for a workshop, tied to its title and topic, refined and motivating so the reader books a seat now. Change the angle every day (practical benefit, scarcity, a micro-story, a question that touches the reader). Rules: never promise profits or financial results, never invent facts that are not in the data, at most one emoji. Return JSON only: {"headline": "up to 60 characters", "body": "two lines, up to 220 characters", "cta": "button label up to 24 characters"}.',
};

function fallback(event: AgendaEvent, lang: AppLang): WorkshopAdCopy {
  return lang === 'en'
    ? { headline: `This week at the club: ${event.title}`.slice(0, 70), body: 'A practical workshop with tools you can use right away. Seats are limited — book yours in one tap.', cta: 'Book your seat' }
    : { headline: `«${event.title}»`.slice(0, 70), body: 'ورشة عملية تخرج منها بأدوات تطبّقها مباشرة في عملك. المقاعد محدودة — احجز مقعدك الآن بضغطة واحدة.', cta: 'احجز مقعدك الآن' };
}

/** The copy rules hold whatever the model wrote. */
function clean(copy: WorkshopAdCopy): WorkshopAdCopy {
  const fix = (text: string): string =>
    text
      .replace(/مجان(ي|ية|يًا|ًا|ا)?/gu, 'بدون رسوم')
      .replace(/(\d)\s*-\s*(\d)/gu, '$1–$2')
      .trim();
  return { headline: fix(copy.headline), body: fix(copy.body), cta: fix(copy.cta) };
}

export class WorkshopAdService {
  private inflight = new Map<string, Promise<WorkshopAd | null>>();

  constructor(private readonly deps: Deps) {}

  /** Today's ad in one language, or null when no workshop is open. */
  today(lang: AppLang, now = Date.now()): Promise<WorkshopAd | null> {
    const key = `${riyadhDay(now)}:${lang}`;
    let run = this.inflight.get(key);
    if (!run) {
      run = this.build(lang, now).finally(() => this.inflight.delete(key));
      this.inflight.set(key, run);
    }
    return run;
  }

  private async build(lang: AppLang, now: number): Promise<WorkshopAd | null> {
    const events = (await this.deps.agenda.upcomingOpen(now)).sort((a, b) => a.date.localeCompare(b.date));
    const event = events[0];
    if (!event) return null;
    const day = riyadhDay(now);
    const stored = await this.deps.kv.get<Stored>(KEY);
    const fresh: Stored = stored && stored.day === day && stored.eventId === event.id ? stored : { day, eventId: event.id, copies: {} };
    let copy = fresh.copies[lang];
    if (!copy) {
      copy = await this.write(event, lang).catch((error: unknown) => {
        this.deps.log.warn({ err: error }, 'workshop ad: the model did not write, the template did');
        return fallback(event, lang);
      });
      fresh.copies[lang] = copy;
      await this.deps.kv.set(KEY, fresh);
    }
    return {
      ...copy,
      eventId: event.id,
      title: event.title,
      date: event.date,
      dates: event.dates?.length ? event.dates : [event.date],
      time: event.time,
      imageUrl: event.imageUrl || event.coverUrl || null,
      feeSar: event.feeSar,
      memberFeeSar: event.memberFeeSar ?? 0,
      day,
    };
  }

  private async write(event: AgendaEvent, lang: AppLang): Promise<WorkshopAdCopy> {
    if (!this.deps.apiKey) return fallback(event, lang);
    const facts = {
      title: event.title,
      dates: event.dates?.length ? event.dates : [event.date],
      time: event.time,
      mode: event.mode,
      feeSar: event.feeSar,
      memberFeeSar: event.memberFeeSar ?? 0,
      about: event.blurb.slice(0, 700),
    };
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.deps.model,
        temperature: 0.95,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM[lang] },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('OpenAI answer has no content');
    return clean(copySchema.parse(JSON.parse(content)));
  }
}

/** Public and the same for everyone in one language: a short shared cache. */
export const workshopAdRoutes: FastifyPluginAsync<{ service: WorkshopAdService }> = async (app, { service }) => {
  app.get(
    '/api/workshop-ad',
    guard(async (request, reply) => {
      reply.header('cache-control', 'public, max-age=600').header('vary', 'x-app-lang');
      return { ad: await service.today(langOf(request)) };
    }),
  );
};
