import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { dashboardGuard, guard, parse, sentOnly } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';
import type { PushMessage, PushService } from '../push/service.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';
import type { MarketGroup, MarketQuote, MarketsService } from './service.js';

/**
 * M179 (owner, 2026-11-01, «خلي المستشار يختار لو في عملة معينة وقعت أو شيء كبير حصل يبعت تنبيه»): the advisor
 * pushes when a tracked quote moves sharply against the previous close, so members get used to hearing from him.
 * Deterministic on purpose: the owner's thresholds decide, no AI call per tick, and the text carries only numbers
 * the feed gave (rule: never predictions, never promised returns). One alert per quote per Riyadh day, a daily cap,
 * quiet hours, members who muted the advisor's messages are skipped, and TASI always says the feed is 15 minutes late.
 */
const SETTINGS_KEY = 'markets:alerts:settings';
const STATE_KEY = 'markets:alerts:state';
const TICK_MS = 60_000;
/** A quote older than this (plus its own delay) is a closed market showing yesterday's move: never alerted. */
const FRESH_MIN = 30;
const DISCLAIMER = 'للاطلاع فقط وليست توصية استثمارية';
const DISCLAIMER_EN = 'For information only, not investment advice';

export const ALERT_GROUPS: readonly MarketGroup[] = ['stocks', 'metals', 'oil', 'fx', 'crypto'];

export type MarketAlertSettings = {
  enabled: boolean;
  /** Percent move against the previous close that triggers an alert, per group. */
  thresholds: Record<MarketGroup, number>;
  /** Most alerts one member receives per Riyadh day. */
  dailyCap: number;
  /** Quiet hours (Riyadh, 0–23): nothing is sent from `quietFrom` up to `quietTo`. Equal values = no quiet hours. */
  quietFrom: number;
  quietTo: number;
};

export const ALERT_DEFAULTS: MarketAlertSettings = {
  enabled: true,
  thresholds: { stocks: 2, metals: 3, oil: 3, fx: 1, crypto: 8 },
  dailyCap: 3,
  quietFrom: 23,
  quietTo: 7,
};

const settingsSchema = z.object({
  enabled: z.boolean(),
  thresholds: z.object(Object.fromEntries(ALERT_GROUPS.map((group) => [group, z.number().min(0.5, 'أقل حد 0.5%').max(50, 'أعلى حد 50%')])) as Record<MarketGroup, z.ZodNumber>),
  dailyCap: z.number().int().min(1).max(10),
  quietFrom: z.number().int().min(0).max(23),
  quietTo: z.number().int().min(0).max(23),
});

type State = { day: string; keys: string[] };

export type MarketAlert = { quote: MarketQuote; direction: 'up' | 'down'; threshold: number };

type Deps = {
  kv: KV;
  log: FastifyBaseLogger;
  markets: MarketsService;
  push: PushService;
  /** Members who muted the advisor's messages (companion). */
  muted: () => Promise<Set<number>>;
  /** '0' kills the whole thing cold (MARKET_ALERTS). */
  enabled: boolean;
};

const clean = (value: number): string => (Math.round(value * 10) / 10).toString();
const amount = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 4 : 2 });

/** The push text for one alert, from the feed's own numbers only. */
export function alertMessage(alert: MarketAlert, lang: 'ar' | 'en', now = Date.now()): PushMessage {
  const { quote, direction } = alert;
  const pct = clean(Math.abs(quote.changePct));
  const price = amount(quote.price);
  const english = lang === 'en';
  const label = english ? quote.labelEn : quote.label;
  const unit = english ? quote.unitEn : quote.unit;
  const title = english
    ? `Advisor: ${label} ${direction === 'up' ? 'jumped' : 'dropped'} ${pct}%`
    : `المستشار: ${label} ${direction === 'up' ? 'ارتفع' : 'انخفض'} ${pct}%`;
  const delay = quote.delayedMin ? (english ? ` Data is ${quote.delayedMin} minutes delayed.` : ` البيانات متأخرة ${quote.delayedMin} دقيقة.`) : '';
  const body = english
    ? `${label} is ${direction === 'up' ? 'up' : 'down'} ${pct}% from the previous close, now ${price} ${unit} (Yahoo Finance).${delay} ${DISCLAIMER_EN}.`
    : `${label} ${direction === 'up' ? 'ارتفع' : 'انخفض'} ${pct}% عن الإغلاق السابق ويتداول عند ${price} ${unit} (المصدر: Yahoo Finance).${delay} ${DISCLAIMER}.`;
  const prompt = english ? `Explain today's move in ${label} briefly` : `اشرح لي حركة ${label} اليوم بإيجاز`;
  const query = new URLSearchParams({ ctxType: 'screen', ctxId: 'markets', ctxTitle: english ? 'Markets' : 'الأسواق', ctxNonce: String(now), prompt });
  return { title, body, data: { screen: `/advisor?${query.toString()}`, type: 'market-alert', key: quote.key } };
}

const inQuiet = (settings: MarketAlertSettings, hour: number): boolean => {
  const { quietFrom: from, quietTo: to } = settings;
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
};

export class MarketAlertsService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (!this.deps.enabled) return;
    this.timer = setInterval(() => void this.tick().catch((error) => this.deps.log.warn({ err: error }, 'market alerts tick failed')), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async settings(): Promise<MarketAlertSettings> {
    const saved = await this.deps.kv.get<Partial<MarketAlertSettings>>(SETTINGS_KEY);
    return { ...ALERT_DEFAULTS, ...saved, thresholds: { ...ALERT_DEFAULTS.thresholds, ...saved?.thresholds } };
  }

  async save(patch: Partial<MarketAlertSettings>): Promise<MarketAlertSettings> {
    const current = await this.settings();
    const next = { ...current, ...patch, thresholds: { ...current.thresholds, ...patch.thresholds } };
    await this.deps.kv.set(SETTINGS_KEY, next);
    return next;
  }

  private async state(day: string): Promise<State> {
    const saved = await this.deps.kv.get<State>(STATE_KEY);
    return saved?.day === day ? saved : { day, keys: [] };
  }

  /** Quotes that crossed their group's threshold and are fresh, strongest first. */
  candidates(quotes: MarketQuote[], settings: MarketAlertSettings, now = Date.now()): MarketAlert[] {
    const out: MarketAlert[] = [];
    for (const quote of quotes) {
      const threshold = settings.thresholds[quote.group];
      if (!(Math.abs(quote.changePct) >= threshold)) continue;
      const age = now - new Date(quote.at).getTime();
      if (!Number.isFinite(age) || age > (FRESH_MIN + (quote.delayedMin ?? 0)) * 60_000) continue;
      out.push({ quote, direction: quote.changePct > 0 ? 'up' : 'down', threshold });
    }
    return out.sort((a, b) => Math.abs(b.quote.changePct) / b.threshold - Math.abs(a.quote.changePct) / a.threshold);
  }

  /** One pass: sends the day's new alerts (never more than the cap), once per quote. Safe to call any time. */
  async tick(now = Date.now()): Promise<number> {
    if (!this.deps.enabled || this.running) return 0;
    this.running = true;
    try {
      const settings = await this.settings();
      if (!settings.enabled || inQuiet(settings, riyadhHour(now))) return 0;
      const day = riyadhDay(now);
      const state = await this.state(day);
      const room = settings.dailyCap - state.keys.length;
      if (room <= 0) return 0;
      const { quotes } = await this.deps.markets.quotes(now);
      const fresh = this.candidates(quotes, settings, now).filter((alert) => !state.keys.includes(alert.quote.key)).slice(0, room);
      if (!fresh.length) return 0;
      // The mark lands BEFORE the sends: a crash mid-way never double-messages the members.
      await this.deps.kv.set(STATE_KEY, { day, keys: [...state.keys, ...fresh.map((alert) => alert.quote.key)] });
      const muted = await this.deps.muted();
      for (const alert of fresh) {
        const outcome = await this.deps.push.broadcastEach((device) => (muted.has(device.contactId) ? null : alertMessage(alert, device.lang === 'en' ? 'en' : 'ar', now)));
        this.deps.log.info({ key: alert.quote.key, changePct: alert.quote.changePct, ...outcome }, 'market alert push');
      }
      return fresh.length;
    } finally {
      this.running = false;
    }
  }

  async status(now = Date.now()): Promise<{ enabled: boolean; sentToday: string[]; watching: { key: string; label: string; group: MarketGroup; changePct: number; threshold: number; delayedMin: number | null; crossed: boolean }[] }> {
    const settings = await this.settings();
    const state = await this.state(riyadhDay(now));
    const { quotes } = await this.deps.markets.quotes(now);
    return {
      enabled: this.deps.enabled,
      sentToday: state.keys,
      watching: quotes.map((quote) => ({
        key: quote.key,
        label: quote.label,
        group: quote.group,
        changePct: quote.changePct,
        threshold: settings.thresholds[quote.group],
        delayedMin: quote.delayedMin ?? null,
        crossed: Math.abs(quote.changePct) >= settings.thresholds[quote.group],
      })),
    };
  }
}

export type MarketAlertRoutesOptions = { service: MarketAlertsService; markets: MarketsService; push: PushService; auth: AuthService };

/** The owner's dashboard card: thresholds, cap, quiet hours, on/off, and a test push to his own device. */
export const marketAlertRoutes: FastifyPluginAsync<MarketAlertRoutesOptions> = async (app, { service, markets, push, auth }) => {
  const requireAdmin = dashboardGuard(auth);

  app.get(
    '/api/admin/market-alerts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      void reply.header('cache-control', 'no-store');
      const [settings, status] = await Promise.all([service.settings(), service.status()]);
      return { settings, defaults: ALERT_DEFAULTS, ...status };
    }),
  );

  app.put(
    '/api/admin/market-alerts',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const body = parse(settingsSchema.partial(), request.body, reply);
      if (!body) return;
      const settings = await service.save(sentOnly(body, request.body));
      return { ok: true, settings };
    }),
  );

  // A sample of the real message for the strongest current mover (or the gold quote), sent to the admin's own devices only.
  app.post(
    '/api/admin/market-alerts/test',
    guard(async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;
      const { quotes } = await markets.quotes();
      const quote = [...quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
      if (!quote) return reply.code(503).send({ error: { code: 'unavailable', message: 'لا توجد أسعار حاليًا' } });
      const message = alertMessage({ quote, direction: quote.changePct >= 0 ? 'up' : 'down', threshold: 0 }, 'ar');
      const outcome = await push.send(admin.session.contactId, { ...message, title: `(تجربة) ${message.title}` });
      return { ok: true, ...outcome, message };
    }),
  );
};
