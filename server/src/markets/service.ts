import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';

import { guard } from '../auth/guard.js';

/**
 * M176 (owner, 2026-11-01, «أسعار الذهب والفضة والبترول»): a live price strip on the home — real
 * market quotes, never written by AI. Yahoo Finance's public endpoints (no key) are read at most
 * once per CACHE_MS for everyone; a failed read keeps the last good quotes, and with none the app
 * simply hides the strip. Gold also shows the Saudi 24k gram (ounce × 3.75 ÷ 31.1035).
 * M178 (owner, 2026-11-01, «السوق السعودي في البداية خالص … وRate فوري»): SYMBOLS order is the app's
 * order (TASI, gold, dollar first, `featured` on the home strip, the rest behind «مشاهدة الكل»),
 * one batched spark read every 30 s, and TASI carries Tadawul's 15-minute delay for free data.
 */
const CACHE_MS = 30_000;
const SAR_PER_USD = 3.75;
const GRAMS_PER_OUNCE = 31.1035;
const SOURCE = 'Yahoo Finance';

export type MarketGroup = 'stocks' | 'metals' | 'oil' | 'fx' | 'crypto';

type Symbol = { key: string; symbol: string; group: MarketGroup; label: string; labelEn: string; unit: string; unitEn: string; featured?: boolean; delayedMin?: number };

const crypto = (key: string, symbol: string, label: string, labelEn: string): Symbol => ({ key, symbol, group: 'crypto', label, labelEn, unit: 'دولار', unitEn: 'USD' });

const SYMBOLS: Symbol[] = [
  { key: 'tasi', symbol: '^TASI.SR', group: 'stocks', label: 'السوق السعودي', labelEn: 'Saudi Market', unit: 'تاسي · نقطة', unitEn: 'TASI · pts', featured: true, delayedMin: 15 },
  { key: 'gold', symbol: 'GC=F', group: 'metals', label: 'الذهب', labelEn: 'Gold', unit: 'دولار/أونصة', unitEn: 'USD/oz', featured: true },
  // M177 (owner, 2026-11-01, «زود عملات مهمة زي الدولار والدرهم»): one unit of each currency in riyals.
  { key: 'usd', symbol: 'SAR=X', group: 'fx', label: 'الدولار الأمريكي', labelEn: 'US Dollar', unit: 'ريال', unitEn: 'SAR', featured: true },
  { key: 'silver', symbol: 'SI=F', group: 'metals', label: 'الفضة', labelEn: 'Silver', unit: 'دولار/أونصة', unitEn: 'USD/oz' },
  { key: 'brent', symbol: 'BZ=F', group: 'oil', label: 'برنت', labelEn: 'Brent', unit: 'دولار/برميل', unitEn: 'USD/bbl' },
  { key: 'wti', symbol: 'CL=F', group: 'oil', label: 'النفط الأمريكي', labelEn: 'WTI', unit: 'دولار/برميل', unitEn: 'USD/bbl' },
  { key: 'aed', symbol: 'AEDSAR=X', group: 'fx', label: 'الدرهم الإماراتي', labelEn: 'UAE Dirham', unit: 'ريال', unitEn: 'SAR' },
  { key: 'eur', symbol: 'EURSAR=X', group: 'fx', label: 'اليورو', labelEn: 'Euro', unit: 'ريال', unitEn: 'SAR' },
  { key: 'gbp', symbol: 'GBPSAR=X', group: 'fx', label: 'الجنيه الإسترليني', labelEn: 'British Pound', unit: 'ريال', unitEn: 'SAR' },
  // M178: the owner's list, in his order.
  crypto('btc', 'BTC-USD', 'بيتكوين', 'Bitcoin'),
  crypto('eth', 'ETH-USD', 'إيثريوم', 'Ethereum'),
  crypto('usdt', 'USDT-USD', 'تيثر', 'Tether'),
  crypto('bnb', 'BNB-USD', 'BNB', 'BNB'),
  crypto('xrp', 'XRP-USD', 'XRP', 'XRP'),
  crypto('sol', 'SOL-USD', 'سولانا', 'Solana'),
  crypto('ada', 'ADA-USD', 'كاردانو', 'Cardano'),
];

export type MarketQuote = {
  key: string;
  group: MarketGroup;
  label: string;
  labelEn: string;
  unit: string;
  unitEn: string;
  /** Shown on the home strip; everything else lives on the markets screen. */
  featured?: boolean;
  /** Minutes the free feed lags the exchange (TASI). */
  delayedMin?: number;
  price: number;
  /** Percent change against the previous close, one decimal. */
  changePct: number;
  /** Gold only: the 24k gram in SAR. */
  gramSar?: number;
  at: string;
};

export type MarketsAnswer = { quotes: MarketQuote[]; source: string; updatedAt: string | null };

type Meta = { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number };

type Deps = { log: FastifyBaseLogger; fetchImpl?: typeof fetch };

export class MarketsService {
  private cache: MarketsAnswer = { quotes: [], source: SOURCE, updatedAt: null };
  private fetchedAt = 0;
  private inflight: Promise<MarketsAnswer> | null = null;

  constructor(private readonly deps: Deps) {}

  async quotes(now = Date.now()): Promise<MarketsAnswer> {
    if (now - this.fetchedAt < CACHE_MS) return this.cache;
    this.inflight ??= this.refresh(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(now: number): Promise<MarketsAnswer> {
    this.fetchedAt = now;
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    // One batched read; a failed batch falls back to one chart read per symbol.
    const metas = await this.spark(fetchImpl).catch(() => null);
    const results = await Promise.all(
      SYMBOLS.map(async (entry) => {
        const meta = metas?.get(entry.symbol) ?? (await this.chart(fetchImpl, entry.symbol).catch(() => null));
        return meta ? toQuote(entry, meta) : null;
      }),
    );
    const quotes = results.filter((quote): quote is MarketQuote => quote !== null);
    if (quotes.length) this.cache = { quotes, source: SOURCE, updatedAt: new Date(now).toISOString() };
    else this.deps.log.warn('market quotes unavailable; keeping the last good ones');
    return this.cache;
  }

  private async spark(fetchImpl: typeof fetch): Promise<Map<string, Meta>> {
    const symbols = SYMBOLS.map((entry) => encodeURIComponent(entry.symbol)).join(',');
    const response = await fetchImpl(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1d&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`spark ${response.status}`);
    const body = (await response.json()) as { spark?: { result?: { symbol?: string; response?: { meta?: Meta }[] }[] } };
    const metas = new Map<string, Meta>();
    for (const row of body.spark?.result ?? []) {
      const meta = row.response?.[0]?.meta;
      if (row.symbol && meta) metas.set(row.symbol, meta);
    }
    return metas;
  }

  private async chart(fetchImpl: typeof fetch, symbol: string): Promise<Meta | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const response = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { chart?: { result?: { meta?: Meta }[] } };
    return body.chart?.result?.[0]?.meta ?? null;
  }
}

function toQuote(entry: Symbol, meta: Meta): MarketQuote | null {
  const price = meta.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const previous = meta.previousClose ?? meta.chartPreviousClose;
  const changePct = typeof previous === 'number' && previous > 0 ? Math.round(((price - previous) / previous) * 1000) / 10 : 0;
  const { symbol: _symbol, ...labels } = entry;
  return {
    ...labels,
    price: price < 10 ? Math.round(price * 10_000) / 10_000 : Math.round(price * 100) / 100,
    changePct,
    ...(entry.key === 'gold' ? { gramSar: Math.round(((price * SAR_PER_USD) / GRAMS_PER_OUNCE) * 100) / 100 } : {}),
    at: new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

/** Public, the same for everyone: no session, short shared cache. */
export const marketsRoutes: FastifyPluginAsync<{ service: MarketsService }> = async (app, { service }) => {
  app.get(
    '/api/markets',
    guard(async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=30');
      return service.quotes();
    }),
  );
};
