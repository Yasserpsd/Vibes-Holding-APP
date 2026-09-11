import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import type { KV } from '../store.js';
import { MIN_RELEVANCE, type Classifier, type ClassifyInput } from './classify.js';
import { findDuplicate, preferred, tierRank, titleTokens } from './dedupe.js';
import { fetchArticle, type PageMeta } from './page.js';
import { fetchFeed, type FeedEntry, type FetchImpl } from './rss.js';
import { getNewsSources, outletNameFor } from './sources.js';
import { fetchSpaSnippet } from './spa.js';
import {
  TIER_LABELS,
  TOPIC_LABELS,
  type NewsItem,
  type NewsPage,
  type NewsPrefs,
  type NewsSnapshot,
  type NewsSource,
  type NewsStatus,
  type PublicNewsItem,
  type SourceStatus,
  type TopicKey,
} from './types.js';

export const NEWS_SNAPSHOT_KEY = 'news:snapshot';
export const DECISIONS_TITLE = 'قرارات وأنظمة المملكة';

const MAX_ITEMS = 1500;
const MAX_NEW_PER_SOURCE = 30;
const PAGE_CONCURRENCY = 4;
const RECENCY_HALF_LIFE_H = 36;

/** Interests assumed from the persona until the member picks their own. */
const PERSONA_TOPICS: Record<string, TopicKey[]> = {
  entrepreneur: ['startups', 'economy', 'tech', 'retail', 'finance'],
  investor: ['markets', 'economy', 'realestate', 'finance', 'energy'],
  neutral: ['economy', 'markets', 'tech'],
};

export type ListQuery = { topic?: TopicKey; page: number; limit: number };
export type Audience = { prefs: NewsPrefs | null; persona: string };

type Indexed = { item: NewsItem; tokens: Set<string> };
type Fresh = { source: NewsSource; entry: FeedEntry };
type Deps = { kv: KV; config: Config; log: FastifyBaseLogger; classifier: Classifier; fetchImpl?: FetchImpl };

export function newsIdOf(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function prefsKey(contactId: number): string {
  return `news:prefs:${contactId}`;
}

/**
 * Polls the sources, verifies every article URL, lets the classifier label the items and keeps
 * the result in memory (snapshot in `kv`). Nothing in an item is written by the server or by AI.
 */
export class NewsService {
  private items = new Map<string, Indexed>();
  private updatedAt: string | null = null;
  private lastError: string | null = null;
  private sourceStatus = new Map<string, SourceStatus>();
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    const snapshot = await this.deps.kv.get<NewsSnapshot>(NEWS_SNAPSHOT_KEY);
    if (snapshot?.items) this.load(snapshot.items, snapshot.updatedAt);
    const minutes = this.deps.config.NEWS_REFRESH_MINUTES;
    if (minutes <= 0) {
      this.deps.log.warn('NEWS_REFRESH_MINUTES=0: news polling is disabled');
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

  private load(items: NewsItem[], updatedAt: string | null): void {
    this.items = new Map(items.map((item) => [item.id, { item, tokens: titleTokens(item.title) }]));
    this.updatedAt = updatedAt;
  }

  private async doRefresh(): Promise<void> {
    const cutoff = Date.now() - this.deps.config.NEWS_MAX_AGE_DAYS * 86_400_000;
    try {
      const sources = (await getNewsSources(this.deps.kv)).filter((source) => source.enabled);
      const fresh = await this.collect(sources, cutoff);
      const verified = await this.verify(fresh);
      const classified = await this.classify(verified);
      let added = 0;
      for (const item of classified) {
        const tokens = titleTokens(item.title);
        const duplicate = findDuplicate(item, tokens, this.items.values());
        if (duplicate) {
          if (preferred(item, duplicate) === item) duplicate.duplicateOf = item.id;
          else item.duplicateOf = duplicate.id;
        }
        this.items.set(item.id, { item, tokens });
        added += 1;
      }
      this.prune(cutoff);
      this.updatedAt = new Date().toISOString();
      this.lastError = null;
      await this.persist();
      this.deps.log.info(
        { sources: sources.length, fresh: fresh.length, verified: verified.length, added, total: this.items.size, classifier: this.deps.classifier.mode },
        'news refreshed',
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'unknown error';
      this.deps.log.error({ reason: this.lastError }, 'news refresh failed');
    }
  }

  /** Reads every enabled feed; entries already known or too old are skipped. */
  private async collect(sources: NewsSource[], cutoff: number): Promise<Fresh[]> {
    const fresh: Fresh[] = [];
    const seen = new Set<string>();
    await Promise.all(
      sources.map(async (source) => {
        const at = new Date().toISOString();
        try {
          const entries = await fetchFeed(source.url, this.deps.fetchImpl);
          let taken = 0;
          for (const entry of entries) {
            const id = newsIdOf(entry.url);
            if (this.items.has(id) || seen.has(id)) continue;
            if (entry.publishedAt && Date.parse(entry.publishedAt) < cutoff) continue;
            seen.add(id);
            fresh.push({ source, entry });
            taken += 1;
            if (taken >= MAX_NEW_PER_SOURCE) break;
          }
          this.sourceStatus.set(source.id, { id: source.id, name: source.name, ok: true, count: entries.length, stored: 0, failed: 0, error: null, at });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          this.sourceStatus.set(source.id, { id: source.id, name: source.name, ok: false, count: 0, stored: 0, failed: 0, error: message, at });
          this.deps.log.warn({ source: source.id, reason: message }, 'news source failed');
        }
      }),
    );
    fresh.sort((a, b) => (b.entry.publishedAt ?? '').localeCompare(a.entry.publishedAt ?? ''));
    return fresh.slice(0, this.deps.config.NEWS_MAX_NEW_PER_RUN);
  }

  /** Fetches each article page (rule 7); an entry whose page cannot be fetched never becomes an item. */
  private async verify(fresh: Fresh[]): Promise<NewsItem[]> {
    const items: NewsItem[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < fresh.length) {
        const next = fresh[cursor++];
        if (!next) return;
        try {
          const page = await fetchArticle(next.entry.url, this.deps.fetchImpl);
          if (next.entry.detailUrl && !next.entry.summary) {
            next.entry.summary = await fetchSpaSnippet(next.entry.detailUrl, this.deps.fetchImpl).catch(() => null);
          }
          items.push(this.toItem(next, page));
        } catch (error) {
          const status = this.sourceStatus.get(next.source.id);
          if (status) status.failed += 1;
          this.deps.log.info({ source: next.source.id, url: next.entry.url, reason: error instanceof Error ? error.message : 'unknown' }, 'article skipped');
        }
      }
    };
    await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, () => worker()));
    return items;
  }

  private toItem({ source, entry }: Fresh, page: PageMeta): NewsItem {
    const aggregated = entry.sourceName !== null;
    const snippet = aggregated ? (page.description ?? entry.summary) : (entry.summary ?? page.description);
    const sourceName = outletNameFor(page.url, entry.sourceName ?? (aggregated ? page.siteName : null) ?? source.name);
    const now = new Date().toISOString();
    return {
      id: newsIdOf(entry.url),
      sourceId: source.id,
      sourceName,
      tier: source.tier,
      lang: source.lang,
      title: entry.title,
      snippet: snippet && snippet !== entry.title ? snippet : null,
      url: entry.url,
      // Sites with a JSON detail (SPA) put their logo in og:image: only the entry's own image counts there.
      image: entry.image ?? (entry.detailUrl ? null : page.image),
      publishedAt: entry.publishedAt ?? page.publishedAt ?? now,
      verifiedAt: now,
      classifiedBy: this.deps.classifier.mode,
      topics: [],
      decision: false,
      businessAngle: false,
      relevance: 0,
      hidden: false,
      duplicateOf: null,
    };
  }

  private async classify(items: NewsItem[]): Promise<NewsItem[]> {
    if (items.length === 0) return items;
    const sources = new Map((await getNewsSources(this.deps.kv)).map((source) => [source.id, source]));
    const inputs: ClassifyInput[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      source: item.sourceName,
      tier: item.tier,
      lang: item.lang,
      hint: sources.get(item.sourceId)?.hint ?? null,
    }));
    const labels = await this.deps.classifier.classify(inputs);
    return items.map((item, index) => {
      const label = labels[index];
      if (!label) return { ...item, hidden: true };
      const sportsOnly = label.topics.includes('sports') && !label.businessAngle;
      const offTopic = !label.decision && label.relevance < MIN_RELEVANCE;
      return { ...item, ...label, hidden: sportsOnly || offTopic };
    });
  }

  private prune(cutoff: number): void {
    for (const [id, { item }] of this.items) {
      if (Date.parse(item.publishedAt) < cutoff) this.items.delete(id);
    }
    if (this.items.size > MAX_ITEMS) {
      const oldest = [...this.items.values()].sort((a, b) => a.item.publishedAt.localeCompare(b.item.publishedAt));
      for (const { item } of oldest.slice(0, this.items.size - MAX_ITEMS)) this.items.delete(item.id);
    }
  }

  private async persist(): Promise<void> {
    const snapshot: NewsSnapshot = { version: 1, items: [...this.items.values()].map(({ item }) => item), updatedAt: this.updatedAt ?? new Date().toISOString() };
    await this.deps.kv.set(NEWS_SNAPSHOT_KEY, snapshot);
  }

  private visible(): NewsItem[] {
    const rows: NewsItem[] = [];
    for (const { item } of this.items.values()) if (!item.hidden && !item.duplicateOf) rows.push(item);
    return rows;
  }

  status(): NewsStatus {
    const rows = this.visible();
    const stored = new Map<string, number>();
    for (const { item } of this.items.values()) stored.set(item.sourceId, (stored.get(item.sourceId) ?? 0) + 1);
    return {
      count: this.items.size,
      visible: rows.length,
      decisions: rows.filter((item) => item.decision).length,
      updatedAt: this.updatedAt,
      lastError: this.lastError,
      running: this.inflight !== null,
      classifier: this.deps.classifier.mode,
      sources: [...this.sourceStatus.values()].map((source) => ({ ...source, stored: stored.get(source.id) ?? 0 })),
    };
  }

  suggestedTopics(persona: string): TopicKey[] {
    return PERSONA_TOPICS[persona] ?? [];
  }

  async prefs(contactId: number): Promise<NewsPrefs | null> {
    return this.deps.kv.get<NewsPrefs>(prefsKey(contactId));
  }

  async savePrefs(contactId: number, topics: TopicKey[]): Promise<NewsPrefs> {
    const prefs: NewsPrefs = { topics, updatedAt: new Date().toISOString() };
    await this.deps.kv.set(prefsKey(contactId), prefs);
    return prefs;
  }

  get(id: string): PublicNewsItem | null {
    const entry = this.items.get(id);
    return entry && !entry.item.hidden ? toPublic(entry.item) : null;
  }

  /** Title and URL for the advisor's screen context («اسأل المستشار عن هذا الخبر»). */
  pageOf(id: string): { title: string; url: string } | null {
    const entry = this.items.get(id);
    return entry ? { title: entry.item.title, url: entry.item.url } : null;
  }

  /** Personalized ranking: source tier, freshness, relevance and the member's interests (or persona defaults). */
  feed(query: ListQuery, audience: Audience): NewsPage {
    const interests = audience.prefs?.topics.length ? audience.prefs.topics : this.suggestedTopics(audience.persona);
    const wanted = new Set(interests);
    let rows = this.visible();
    if (query.topic) rows = rows.filter((item) => item.topics.includes(query.topic as TopicKey));
    const now = Date.now();
    const scored = rows
      .map((item) => ({ item, score: scoreOf(item, wanted, now) }))
      .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt));
    return paginate(scored.map(({ item }) => item), query, this.updatedAt, wanted.size > 0);
  }

  /** The fixed section, newest first, the same for everyone. */
  decisions(query: Omit<ListQuery, 'topic'>): NewsPage {
    const rows = this.visible()
      .filter((item) => item.decision)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return paginate(rows, query, this.updatedAt, false);
  }
}

function scoreOf(item: NewsItem, wanted: Set<TopicKey>, now: number): number {
  const ageHours = Math.max(0, now - Date.parse(item.publishedAt)) / 3_600_000;
  const recency = 40 * Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_H);
  const interest = item.topics.some((topic) => wanted.has(topic)) ? 25 : 0;
  return tierRank(item.tier) * 8 + recency + item.relevance * 0.3 + interest;
}

function paginate(rows: NewsItem[], query: { page: number; limit: number }, updatedAt: string | null, personalized: boolean): NewsPage {
  const start = (query.page - 1) * query.limit;
  const items = rows.slice(start, start + query.limit).map(toPublic);
  return { items, page: query.page, limit: query.limit, total: rows.length, hasMore: start + items.length < rows.length, updatedAt, personalized };
}

export function toPublic(item: NewsItem): PublicNewsItem {
  return {
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    url: item.url,
    image: item.image,
    publishedAt: item.publishedAt,
    source: { id: item.sourceId, name: item.sourceName, tier: item.tier, tierLabel: TIER_LABELS[item.tier] },
    topics: item.topics.map((key) => ({ key, label: TOPIC_LABELS[key] })),
    decision: item.decision,
    lang: item.lang,
  };
}
