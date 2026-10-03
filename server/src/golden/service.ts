import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import { GOLDEN_CONTENT_KEY, GOLDEN_SEED, type GoldenContent } from '../content/golden.js';
import type { KV } from '../store.js';
import { parseOfferPage, type OfferBlock } from './parse.js';

/** A company's offer page as the app renders it: parsed blocks plus where they came from. */
export type CompanyOffer = {
  code: string;
  sourceUrl: string;
  blocks: OfferBlock[];
  fetchedAt: string;
};

type OffersSnapshot = { offers: Record<string, CompanyOffer>; updatedAt: string | null };

export const OFFERS_KEY = 'golden:offers';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGE_CHARS = 1_500_000;
/** Below this the page answered with an error or a stub: the previous good copy stays. */
const MIN_BLOCKS = 2;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

type Deps = {
  kv: KV;
  config: Config;
  log: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
  /** Called when a refresh brought different content (/api/sync). */
  onChange?: () => void;
};

/**
 * Keeps a native copy of every golden company's web /offer/ page (owner decision 2026-09-13 and
 * 2026-10-04: pulled from WordPress automatically, not dashboard-entered). A failed fetch never
 * drops a page: the last good copy answers until the site comes back.
 */
export class GoldenOffersService {
  private offers = new Map<string, CompanyOffer>();
  private updatedAt: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private contentHash: string | null = null;

  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    const snapshot = await this.deps.kv.get<OffersSnapshot>(OFFERS_KEY);
    if (snapshot) {
      this.offers = new Map(Object.entries(snapshot.offers));
      this.updatedAt = snapshot.updatedAt;
      this.contentHash = hashOf(this.offers);
    }
    const minutes = this.deps.config.GOLDEN_REFRESH_MINUTES;
    if (minutes <= 0) {
      this.deps.log.warn('GOLDEN_REFRESH_MINUTES is 0: golden offer sync is disabled');
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), minutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  get(code: string): CompanyOffer | null {
    return this.offers.get(code) ?? null;
  }

  status(): { count: number; updatedAt: string | null; lastError: string | null } {
    return { count: this.offers.size, updatedAt: this.updatedAt, lastError: this.lastError };
  }

  private async doRefresh(): Promise<void> {
    const content = (await this.deps.kv.get<GoldenContent>(GOLDEN_CONTENT_KEY)) ?? GOLDEN_SEED;
    const companies = [content.umbrella, ...content.companies];
    const failures: string[] = [];
    for (const company of companies) {
      try {
        const offer = await this.fetchOffer(company.code, company.offerUrl);
        this.offers.set(company.code, offer);
      } catch (error) {
        failures.push(`${company.code}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    this.updatedAt = new Date().toISOString();
    this.lastError = failures.length ? failures.join(' | ') : null;
    const contentHash = hashOf(this.offers);
    if (this.contentHash !== null && this.contentHash !== contentHash) this.deps.onChange?.();
    this.contentHash = contentHash;
    await this.deps.kv
      .set(OFFERS_KEY, { offers: Object.fromEntries(this.offers), updatedAt: this.updatedAt } satisfies OffersSnapshot)
      .catch((error: unknown) => this.deps.log.error({ err: error }, 'golden offers snapshot not saved'));
    if (failures.length) this.deps.log.warn({ failures }, 'golden offer pages: some fetches failed');
    this.deps.log.info({ count: this.offers.size }, 'golden offer pages refreshed');
  }

  private async fetchOffer(code: string, url: string): Promise<CompanyOffer> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7', 'accept-language': 'ar,en;q=0.6' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = (await response.text()).slice(0, MAX_PAGE_CHARS);
    const blocks = parseOfferPage(html, response.url || url);
    if (blocks.length < MIN_BLOCKS) throw new Error(`page gave ${blocks.length} blocks`);
    return { code, sourceUrl: url, blocks, fetchedAt: new Date().toISOString() };
  }
}

function hashOf(offers: Map<string, CompanyOffer>): string {
  const stable = [...offers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, offer]) => ({ code, blocks: offer.blocks }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
