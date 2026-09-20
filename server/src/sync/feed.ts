import type { FastifyBaseLogger } from 'fastify';

import { HubError, hubCall, type HubChange, type HubClient } from '../hub/types.js';
import { parseHubTime } from '../riyadh.js';

/**
 * `GET /api/feed`: what changed on the ecosystem's websites and in the app's own posts, from the hub's `changes` op
 * (docs/BRIDGE_V2.md 1.3). Public fields only. The hub indexes every page of every site, the membership and payment
 * pages with their web prices included: those never reach the app (CLAUDE.md rule 3).
 */
export type FeedItem = { id: number; site: string; host: string; url: string; title: string; kind: string; excerpt: string; updatedAt: string | null };
export type FeedPage = { cursor: number; items: FeedItem[]; supported: boolean };

const CACHE_MS = 60_000;
const RETRY_MS = 10_000;
const SNAPSHOT_ROWS = 100;
// A page that sells the membership or takes a payment, by its address or its title.
const SELLS_MEMBERSHIP =
  /عضوي|[اإ]شترك|[اإ]شتراك|باق(?:ة|ات)|انضم|سعر|[أا]سعار|تسعير|(?<!بدون\s)رسوم|ادفع|الدفع|membership|subscri|pricing|\bplans\b|\bjoin\b|checkout|paymob|\/pay(?:ment)?(?:[/?#]|$)/i;
// An amount with its currency, in either order: «3,000 ريال», «٥٠٠ ر.س», «SAR 3000», «$99».
const CURRENCY = String.raw`(?:ريال|ر\.?\s?س(?![ء-ي])|SAR\b|SR\b|﷼|دولار|USD\b)`;
const PRICE = new RegExp(String.raw`[\d٠-٩][\d٠-٩,.٬٫]*\s*${CURRENCY}|(?:${CURRENCY}|\$)\s*[\d٠-٩]`, 'i');
const URL_IN_TEXT = /https?:\/\/[^\s<>()«»"']+/gi;

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Arabic slugs arrive percent-encoded; the words are checked as a person reads them. */
function readable(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export function toFeedItem(row: HubChange): FeedItem | null {
  const url = clip(row.url, 600);
  const title = clip(row.title, 200);
  let excerpt = clip(row.excerpt, 300);
  if (!title || !/^(https?|app):\/\//i.test(url)) return null;
  // The app's own posts (`app://posts/<key>`) were written for the app; the rules below are for website pages.
  if (/^https?:/i.test(url)) {
    if (SELLS_MEMBERSHIP.test(readable(url)) || SELLS_MEMBERSHIP.test(title) || PRICE.test(title)) return null;
    const priced = PRICE.test(excerpt);
    const sells = SELLS_MEMBERSHIP.test(excerpt);
    // A page that quotes a price while talking about the membership is a sales page under another name.
    if (priced && sells) return null;
    // No web price and no call to subscribe reaches the app, whatever the page is about: the item stays, its excerpt goes.
    if (priced || sells) excerpt = '';
  }
  const at = parseHubTime(clip(row.updated_at, 40));
  return { id: Number(row.id) || 0, site: clip(row.site, 120), host: clip(row.host, 120), url, title, kind: clip(row.kind, 40) || 'page', excerpt: excerpt.replace(URL_IN_TEXT, '').trim(), updatedAt: Number.isNaN(at) ? null : new Date(at).toISOString() };
}

type Deps = { hub: HubClient; log: FastifyBaseLogger };
type Snapshot = { at: number; cursor: number; items: FeedItem[]; supported: boolean };

export class FeedService {
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private failure: { at: number; error: unknown } | null = null;

  constructor(private readonly deps: Deps) {}

  /** The hub's webhook (or a post handed to the hub) says the knowledge changed: the next request asks the hub again. */
  bust(): void {
    if (this.snapshot) this.snapshot.at = 0;
    this.loading = null;
    this.failure = null;
  }

  /**
   * The route is public, so nothing a caller sends reaches the hub: one snapshot of the hub's latest rows serves
   * everyone, asked for at most once a minute (once in ten seconds while the hub fails).
   */
  private latest(): Promise<Snapshot> {
    const known = this.snapshot;
    const now = Date.now();
    if (known && now - known.at < CACHE_MS) return Promise.resolve(known);
    if (this.loading) return this.loading;
    if (this.failure && now - this.failure.at < RETRY_MS) return known ? Promise.resolve(known) : Promise.reject(this.failure.error);
    const job: Promise<Snapshot> = this.load().then(
      (value) => {
        if (this.loading === job) {
          this.loading = null;
          this.failure = null;
          this.snapshot = value;
        }
        return value;
      },
      (error: unknown) => {
        if (this.loading === job) {
          this.loading = null;
          this.failure = { at: Date.now(), error };
        }
        // The last good rows are better than an error screen.
        if (!known) throw error;
        this.deps.log.warn({ err: error }, 'hub changes failed, serving the last feed');
        return known;
      },
    );
    this.loading = job;
    return job;
  }

  private async load(): Promise<Snapshot> {
    try {
      const result = await hubCall(this.deps.hub, 'changes', { since_id: 0, kinds: [], limit: SNAPSHOT_ROWS });
      const items = (result.items ?? []).map(toFeedItem).filter((item): item is FeedItem => item !== null).sort((a, b) => b.id - a.id);
      return { at: Date.now(), cursor: Number(result.cursor) || 0, items, supported: true };
    } catch (error) {
      // A hub older than 2.7.0: the app gets an empty feed, not an error screen.
      if (!(error instanceof HubError) || error.code !== 'hub_not_supported') throw error;
      return { at: Date.now(), cursor: 0, items: [], supported: false };
    }
  }

  async changes(query: { since: number; kinds: string[]; limit: number }): Promise<FeedPage> {
    const snapshot = await this.latest();
    const items = snapshot.items.filter((item) => item.id > query.since && (!query.kinds.length || query.kinds.includes(item.kind))).slice(0, query.limit);
    return { cursor: Math.max(snapshot.cursor, query.since), items, supported: snapshot.supported };
  }
}
