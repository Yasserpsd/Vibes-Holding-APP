import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';

import { guard } from '../auth/guard.js';

/**
 * M176 (owner, 2026-11-01, «أسعار الذهب والفضة والبترول»): a live price strip on the home — real
 * market quotes, never written by AI. Yahoo Finance's public chart endpoint (no key) is read at
 * most once per CACHE_MS for everyone; a failed read keeps the last good quotes, and with none
 * the app simply hides the strip. Gold also shows the Saudi 24k gram (ounce × 3.75 ÷ 31.1035).
 */
const CACHE_MS = 10 * 60_000;
const SAR_PER_USD = 3.75;
const GRAMS_PER_OUNCE = 31.1035;
const SOURCE = 'Yahoo Finance';

type Symbol = { key: string; symbol: string; label: string; labelEn: string; unit: string; unitEn: string };

const SYMBOLS: Symbol[] = [
  { key: 'gold', symbol: 'GC=F', label: 'الذهب', labelEn: 'Gold', unit: 'دولار/أونصة', unitEn: 'USD/oz' },
  { key: 'silver', symbol: 'SI=F', label: 'الفضة', labelEn: 'Silver', unit: 'دولار/أونصة', unitEn: 'USD/oz' },
  { key: 'brent', symbol: 'BZ=F', label: 'برنت', labelEn: 'Brent', unit: 'دولار/برميل', unitEn: 'USD/bbl' },
  { key: 'wti', symbol: 'CL=F', label: 'النفط الأمريكي', labelEn: 'WTI', unit: 'دولار/برميل', unitEn: 'USD/bbl' },
  { key: 'btc', symbol: 'BTC-USD', label: 'بيتكوين', labelEn: 'Bitcoin', unit: 'دولار', unitEn: 'USD' },
];

export type MarketQuote = {
  key: string;
  label: string;
  labelEn: string;
  unit: string;
  unitEn: string;
  price: number;
  /** Percent change against the previous close, one decimal. */
  changePct: number;
  /** Gold only: the 24k gram in SAR. */
  gramSar?: number;
  at: string;
};

export type MarketsAnswer = { quotes: MarketQuote[]; source: string; updatedAt: string | null };

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
    const results = await Promise.all(SYMBOLS.map((entry) => this.one(fetchImpl, entry).catch(() => null)));
    const quotes = results.filter((quote): quote is MarketQuote => quote !== null);
    if (quotes.length) this.cache = { quotes, source: SOURCE, updatedAt: new Date(now).toISOString() };
    else this.deps.log.warn('market quotes unavailable; keeping the last good ones');
    return this.cache;
  }

  private async one(fetchImpl: typeof fetch, entry: Symbol): Promise<MarketQuote | null> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(entry.symbol)}?range=1d&interval=1d`;
    const response = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number } }[] } };
    const meta = body.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
    const previous = meta?.previousClose ?? meta?.chartPreviousClose;
    const changePct = typeof previous === 'number' && previous > 0 ? Math.round(((price - previous) / previous) * 1000) / 10 : 0;
    const { symbol: _symbol, ...labels } = entry;
    return {
      ...labels,
      price: Math.round(price * 100) / 100,
      changePct,
      ...(entry.key === 'gold' ? { gramSar: Math.round(((price * SAR_PER_USD) / GRAMS_PER_OUNCE) * 100) / 100 } : {}),
      at: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }
}

/** Public, the same for everyone: no session, short shared cache. */
export const marketsRoutes: FastifyPluginAsync<{ service: MarketsService }> = async (app, { service }) => {
  app.get(
    '/api/markets',
    guard(async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      return service.quotes();
    }),
  );
};
