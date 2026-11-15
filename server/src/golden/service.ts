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
  /**
   * M242: the same page for the English app — block for block, the pictures untouched. A block whose English
   * could not be made, or whose numbers came back different, stays in Arabic here. Absent until the first pass.
   */
  blocksEn?: OfferBlock[];
  /** The Arabic blocks `blocksEn` was made from (a hash): a changed page starts its English again. */
  enSource?: string;
};

/** M242: the slice of EnglishCache the offer pages need (absent = no English copy, e.g. in older tests). */
export type OfferEnglish = { texts(list: string[], lang: 'en'): Promise<string[]> };

const ARABIC = /[؀-ۿ]/;
const asciiDigits = (text: string): string =>
  text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));

/**
 * M242: an offer page speaks in figures (valuations, shares, percentages), and no translation may move one.
 * True when both texts hold exactly the same runs of digits — whatever their order — and agree on whether a
 * percentage is spoken of. «مليون» and "million" are words on both sides, so they never count.
 */
export function sameFigures(arabic: string, english: string): boolean {
  const runs = (text: string): string => (asciiDigits(text).match(/\d+/g) ?? []).sort().join(' ');
  const percent = (text: string): boolean => /[%٪]|percent/i.test(text);
  if (runs(arabic) !== runs(english) || percent(arabic) !== percent(english)) return false;
  // The digits alone do not make a figure: «10 مليون ريال» as "10 billion dollars" keeps every digit. Each scale
  // and each currency must be named the same number of times on both sides.
  return FIGURE_WORDS.every(([inArabic, inEnglish]) => (arabic.match(inArabic) ?? []).length === (english.match(inEnglish) ?? []).length);
}

/** A scale or a currency as each language writes it: [Arabic, English]. A plural counts once («ملايين», "millions"). */
const FIGURE_WORDS: [RegExp, RegExp][] = [
  [/مليون|ملايين/g, /million/gi],
  [/مليار/g, /billion/gi],
  [/(?<![ء-ي])[وبلف]?(?:ألف|الف|آلاف|الاف)(?![ء-ي])/g, /thousand/gi],
  [/ريال|﷼/g, /\bSAR\b|riyal/gi],
  [/دولار/g, /\bUSD\b|\$|dollar/gi],
];

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
  /** M242: puts the pages into English (cached per text, so an unchanged page costs nothing). */
  english?: OfferEnglish;
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
        // An unchanged page keeps the English it already has.
        const previous = this.offers.get(company.code);
        const kept = previous?.blocksEn && previous.enSource === sourceOf(offer.blocks) ? { blocksEn: previous.blocksEn, enSource: previous.enSource } : {};
        this.offers.set(company.code, { ...offer, ...kept });
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
    // The Arabic pages are saved and answering; their English follows behind them and is never waited for
    // (the dashboard's «تحديث الآن» waits for this refresh, and a first pass over every page takes minutes).
    this.translateSoon();
  }

  private englishPass: Promise<void> | null = null;
  private englishAgain = false;

  /**
   * Starts the English pass behind the caller. One pass at a time: a refresh that lands while a pass is running
   * gets a pass of its own right after it, so the newest pages are always the last ones translated.
   */
  private translateSoon(): void {
    if (!this.deps.english) return;
    if (this.englishPass) {
      this.englishAgain = true;
      return;
    }
    this.englishPass = this.translate()
      .then(() => undefined)
      .catch((error: unknown) => this.deps.log.warn({ err: error }, 'golden offer pages: the English pass failed'))
      .finally(() => {
        this.englishPass = null;
        if (this.englishAgain) {
          this.englishAgain = false;
          this.translateSoon();
        }
      });
  }

  /** Resolves once no English pass is running (tests, and a tidy shutdown). */
  async englishIdle(): Promise<void> {
    while (this.englishPass) await this.englishPass;
  }

  /**
   * M242 (complaint «عربي في وضع الإنجليزية»): 600 of the 615 text blocks of the eleven offer pages reached the
   * English app in Arabic. Every text block gets its English once (the cache keeps it per text); the figures are
   * checked to be untouched, and a block that fails the check stays Arabic. Returns how many blocks changed.
   */
  async translate(): Promise<number> {
    const english = this.deps.english;
    if (!english) return 0;
    let changed = 0;
    let kept = 0;
    // A copy of the list: a refresh may replace pages while this pass is waiting for the translator.
    for (const [code, offer] of [...this.offers]) {
      const source = sourceOf(offer.blocks);
      const current = offer.enSource === source && offer.blocksEn?.length === offer.blocks.length ? offer.blocksEn : offer.blocks;
      // The text blocks that still read Arabic in the English copy.
      const pending = offer.blocks.flatMap((block, index) => {
        const shown = current[index];
        return block.type !== 'image' && ARABIC.test(block.text) && !(shown && shown.type !== 'image' && !ARABIC.test(shown.text)) ? [index] : [];
      });
      const next = current.map((block) => ({ ...block }));
      let pageChanged = 0;
      let pageKept = 0;
      if (pending.length) {
        const texts = await english.texts(pending.map((index) => (offer.blocks[index] as Exclude<OfferBlock, { type: 'image' }>).text), 'en');
        pending.forEach((index, position) => {
          const block = offer.blocks[index] as Exclude<OfferBlock, { type: 'image' }>;
          const text = (texts[position] ?? '').trim();
          if (!text || ARABIC.test(text)) return;
          if (!sameFigures(block.text, text)) {
            pageKept += 1;
            return;
          }
          next[index] = { ...block, text };
          pageChanged += 1;
        });
      }
      // A newer refresh replaced this page while the translator was answering: what was read here is the older
      // page, and writing it back would undo the refresh. The pass that follows the refresh takes the new one.
      if (this.offers.get(code) !== offer) continue;
      this.offers.set(code, { ...offer, blocksEn: next, enSource: source });
      changed += pageChanged;
      kept += pageKept;
    }
    if (changed) {
      await this.deps.kv
        .set(OFFERS_KEY, { offers: Object.fromEntries(this.offers), updatedAt: this.updatedAt } satisfies OffersSnapshot)
        .catch((error: unknown) => this.deps.log.error({ err: error }, 'golden offers snapshot not saved'));
      this.deps.onChange?.();
    }
    if (changed || kept) this.deps.log.info({ changed, keptArabic: kept }, 'golden offer pages: English pass');
    return changed;
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

/** What an English copy was made from: the Arabic blocks themselves. */
function sourceOf(blocks: OfferBlock[]): string {
  return createHash('sha256').update(JSON.stringify(blocks)).digest('hex').slice(0, 32);
}

function hashOf(offers: Map<string, CompanyOffer>): string {
  const stable = [...offers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, offer]) => ({ code, blocks: offer.blocks }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
