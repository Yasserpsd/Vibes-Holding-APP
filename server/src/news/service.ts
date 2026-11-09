import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import { riyadhDay, riyadhHour } from '../riyadh.js';
import type { KV } from '../store.js';
import { MIN_RELEVANCE, decisionGuard, mentionsSaudi, moneyGuard, type Classifier, type ClassifyInput } from './classify.js';
import { findDuplicate, preferred, tierRank, titleTokens } from './dedupe.js';
import { GEO_BOOST, geoFor } from './geo.js';
import { fetchArticle, type PageMeta } from './page.js';
import { fetchFeed, type FeedEntry, type FetchImpl } from './rss.js';
import { getNewsSources, outletNameFor } from './sources.js';
import { fetchSpaSnippet } from './spa.js';
import {
  CORE_TOPICS,
  MONEY_TOPICS,
  TOPIC_KEYS,
  moneyTopics,
  tierLabel,
  topicLabel,
  type NewsItem,
  type NewsLang,
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
export const DECISIONS_TITLE_EN = 'Saudi Decisions & Regulations';

export function decisionsTitle(lang: NewsLang): string {
  return lang === 'en' ? DECISIONS_TITLE_EN : DECISIONS_TITLE;
}

const MAX_ITEMS = 1500;
const MAX_NEW_PER_SOURCE = 30;
const PAGE_CONCURRENCY = 4;
// M116d (owner: «الأخبار قديمة اوي، عايزها أحدث»): freshness rules the feed — a story loses half
// its recency score every 14 hours (was 36), and recency outweighs the tier ladder.
const RECENCY_HALF_LIFE_H = 14;

/** Interests assumed from the persona until the member picks their own. */
const PERSONA_TOPICS: Record<string, TopicKey[]> = {
  // M219: money sections only (the owner dropped sports and every non-money section, 2026-11-09).
  neutral: ['economy', 'markets', 'finance'],
  entrepreneur: ['economy', 'finance', 'markets'],
  investor: ['markets', 'economy', 'finance', 'energy'],
};

/** `lang` picks the feed: Arabic sources for the Arabic app, English sources for the English one (never translated, rule 7). */
export type ListQuery = { topic?: TopicKey; page: number; limit: number; lang?: NewsLang; scope?: 'home' };

/**
 * M182 (owner, 2026-11-02, «ديما الأخبار اللي في الرئيسية ليها علاقة بالمال والأعمال والنفط والذهب
 * والعملات الرقمية … وخصوصا الأخبار الشقية اوي»): the home carousel shows money news only, and the
 * stories with teeth first. Selection and ranking only — rule 7 holds, the words stay the source's.
 */
const HOME_TOPICS: ReadonlySet<TopicKey> = new Set(MONEY_TOPICS);
/** The spice: numbers that shock, deals, crashes, records — the headlines that make people open the app. */
const SPARK = [
  /مليار|تريليون|قياسي|تاريخي|استحواذ|اندماج|صفقة|اكتتاب|إفلاس|انهيار|يقفز|قفز|صاروخي|هبوط حاد|تراجع حاد|يتجاوز|لأول مرة|عقوبات|غرامة|تحذير|يحذر|مفاجئ|مفاجأة|أعلى مستوى|أدنى مستوى|خسائر|أرباح قياسية|ملياردير|ثروة/u,
  /billion|trillion|record|historic|acquisition|merger|deal|ipo|bankruptcy|crash|surge|soars|plunge|jumps|sanctions|fine|warning|shock|all-time|first time|billionaire|fortune/iu,
];
// M182c «رقم اليوم»: the biggest figure a money headline printed in the last 24 h — the source's own
// words (rule 7), picked by magnitude: scale words (مليار، تريليون…) beat bare percentages.
const SCALE_WORDS: Record<string, number> = { تريليون: 1e12, trillion: 1e12, مليار: 1e9, billion: 1e9, مليون: 1e6, million: 1e6, ألف: 1e3, thousand: 1e3, '%': 1, '٪': 1 };
const FIGURE = /([0-9٠-٩][0-9٠-٩.,،٬٫]*)\s*(تريليون|مليار|مليون|ألف|trillion|billion|million|thousand|%|٪)/giu;
const westernDigits = (text: string): string => text.replace(/[٠-٩]/gu, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

export function biggestFigure(text: string): { magnitude: number; text: string } | null {
  let best: { magnitude: number; text: string } | null = null;
  for (const match of text.matchAll(FIGURE)) {
    const raw = westernDigits(match[1] ?? '').replace(/[,،٬]/gu, '').replace(/٫/gu, '.');
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const magnitude = value * (SCALE_WORDS[(match[2] ?? '').toLowerCase()] ?? 1);
    if (!best || magnitude > best.magnitude) best = { magnitude, text: (match[0] ?? '').trim() };
  }
  return best;
}

export type NumberOfDay = { text: string; item: PublicNewsItem };

/** Up to +28 on top of scoreOf's ~140 scale: spice beats a few hours of age, never a day's. */
function sparkOf(item: NewsItem): number {
  const text = `${item.title} ${item.snippet ?? ''}`;
  let hits = 0;
  for (const pattern of SPARK) {
    const found = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
    hits += found ? found.length : 0;
  }
  return Math.min(28, hits * 10);
}
export type Audience = { prefs: NewsPrefs | null; persona: string };

/**
 * M219 (owner, 2026-11-09: «تختار ديما الأخبار اللي ليها صورة … ودي قاعدة ثابتة»): only a story with a real
 * photo of its own is ever shown or pushed. What went wrong before: Bing thumbnails arrived as http://
 * (phones refuse cleartext), some URLs kept the feed's «&amp;», and outlets answer with a «no image» file
 * or their logo when the article has no photo.
 */
const PLACEHOLDER_IMAGE = /no[-_]?image|placeholder|default[-_.]|logo|argaam-plus/i;
/** The same file on this many stored items is the outlet's brand image, not a photo. */
const BRAND_IMAGE_USES = 3;

export function cleanImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const fixed = url.trim().replace(/&amp;/gi, '&').replace(/^http:\/\//i, 'https://');
  try {
    const parsed = new URL(fixed);
    if (parsed.protocol !== 'https:' || PLACEHOLDER_IMAGE.test(parsed.pathname)) return null;
  } catch {
    return null;
  }
  return fixed;
}

type Indexed = { item: NewsItem; tokens: Set<string> };
type Fresh = { source: NewsSource; entry: FeedEntry };
type Deps = { kv: KV; config: Config; log: FastifyBaseLogger; classifier: Classifier; fetchImpl?: FetchImpl; /** Called after a run that stored new items (/api/sync). */ onChange?: () => void; };

/**
 * M136 (owner, 2026-10-28: «العملاء اشتكوا من كتر الأخبار — خبرين فقط في اليوم لكل مجال، حسب اهتماماته»)
 * replaces the M135 hourly pushes. The day has two EDITIONS (Riyadh EDITION_HOURS); each edition picks ONE
 * story per topic — the best fresh story (last 24h) never picked before, every story placed under one topic
 * only — so a topic never gets more than two stories a day. The feed shows only the picks of the latest two
 * editions, narrowed to the member's interests; each edition sends ONE push per device: the best pick among
 * that account's interests (else the edition's best story), per device language (M122), the body always the
 * source's own title (rule 7). Two pushes a day per device, never more; nothing is ever pushed twice.
 */
export const NEWS_PICKS_KEY = 'news:daily:picks';
export const EDITION_HOURS = [10, 19] as const;
const PICKS_PER_TOPIC_PER_EDITION = 1;
const MAX_PER_TOPIC_PER_DAY = PICKS_PER_TOPIC_PER_EDITION * EDITION_HOURS.length;
const PICKED_IDS_MAX = 600;
export type EditionPick = { topic: TopicKey; id: string };
export type Edition = { day: string; slot: number; filledAt: string; picks: Record<NewsLang, EditionPick[]>; pushedAt: string | null };
export type PicksState = { editions: Edition[]; pickedIds: string[]; /** The selection rules the picks were made under (PICKS_RULE). */ rule?: number };
/** M219: money-only, photo-only picks. Editions picked under an older rule are picked again once (never pushed again). */
export const PICKS_RULE = 3;

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
  /** M61: per-source ranking boost (owner: «ركز أوي على أرقام»), refreshed with the sources on every run. */
  private boosts = new Map<string, number>();
  private updatedAt: string | null = null;
  private lastError: string | null = null;
  private sourceStatus = new Map<string, SourceStatus>();
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  /** M136: the day's editions (latest first), kept in memory so the feed answers synchronously. */
  private picks: PicksState = { editions: [], pickedIds: [] };
  /** M219: how many stored items carry each image — a file shared by several is a brand image. */
  private imageUse = new Map<string, number>();
  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    const snapshot = await this.deps.kv.get<NewsSnapshot>(NEWS_SNAPSHOT_KEY);
    if (snapshot?.items) this.load(snapshot.items, snapshot.updatedAt);
    const picks = await this.deps.kv.get<PicksState>(NEWS_PICKS_KEY);
    if (picks?.editions) this.picks = { editions: picks.editions, pickedIds: picks.pickedIds ?? [], rule: picks.rule };
    this.loadBoosts(await getNewsSources(this.deps.kv));
    if (this.picks.rule !== PICKS_RULE) await this.repick();
    await this.runEditions();
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
    // M219: the stored items obey today's rules too — money sections only, cleaned image URLs.
    this.items = new Map(
      items.map((stored) => {
        const topics = moneyTopics(stored.topics);
        const hidden = stored.hidden || !moneyGuard(stored.title, topics);
        const item: NewsItem = { ...stored, topics, hidden, decision: stored.decision && !hidden, image: cleanImage(stored.image) };
        return [item.id, { item, tokens: titleTokens(item.title) }];
      }),
    );
    this.updatedAt = updatedAt;
    this.countImages();
  }

  private countImages(): void {
    this.imageUse = new Map();
    for (const { item } of this.items.values()) if (item.image) this.imageUse.set(item.image, (this.imageUse.get(item.image) ?? 0) + 1);
  }

  /** The story's own photo, or null when it has none (or carries only the outlet's brand image). */
  private photoOf(item: NewsItem): string | null {
    return item.image && (this.imageUse.get(item.image) ?? 0) < BRAND_IMAGE_USES ? item.image : null;
  }

  private loadBoosts(sources: NewsSource[]): void {
    this.boosts = new Map(sources.filter((source) => typeof source.boost === 'number' && source.boost !== 0).map((source) => [source.id, source.boost!]));
  }

  private async doRefresh(): Promise<void> {
    const cutoff = Date.now() - this.deps.config.NEWS_MAX_AGE_DAYS * 86_400_000;
    try {
      const all = await getNewsSources(this.deps.kv);
      this.loadBoosts(all);
      const sources = all.filter((source) => source.enabled);
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
      this.countImages();
      this.updatedAt = new Date().toISOString();
      this.lastError = null;
      await this.persist();
      if (added > 0) this.deps.onChange?.();
      await this.runEditions();
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
          const entries = await fetchFeed(source.url, this.deps.fetchImpl, source.lang);
          // Such a feed is read for its Saudi stories only; the rest never costs a page fetch or a label.
          const saudiOnly = source.saudiOnly === true;
          let taken = 0;
          for (const entry of entries) {
            const id = newsIdOf(entry.url);
            if (this.items.has(id) || seen.has(id)) continue;
            if (entry.publishedAt && Date.parse(entry.publishedAt) < cutoff) continue;
            if (saudiOnly && !mentionsSaudi(entry.title, entry.summary, source.tier)) continue;
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
          const page = await fetchArticle(next.entry.url, this.deps.fetchImpl, next.source.lang);
          if (next.entry.detailUrl && !next.entry.summary) {
            next.entry.summary = await fetchSpaSnippet(next.entry.detailUrl, this.deps.fetchImpl, next.source.lang).catch(() => null);
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
    const sourceName = outletNameFor(page.url, entry.sourceName ?? (aggregated ? page.siteName : null) ?? source.name, source.lang);
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
      // Sites with a JSON detail (SPA) put their logo in og:image: only the entry's own image counts as the photo,
      // but the logo is kept as the brand fallback (owner, 2026-10-17: every item must show an image).
      image: cleanImage(entry.image) ?? (entry.detailUrl ? null : cleanImage(page.image)),
      brandImage: entry.detailUrl ? page.image : null,
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
      const input = inputs[index];
      if (!label || !input) return { ...item, hidden: true };
      // M219: money news only — the other sections are dropped and a headline that does not speak money stays hidden.
      const topics = moneyTopics(label.topics);
      const money = moneyGuard(item.title, topics);
      const decision = money && label.decision && decisionGuard(input, topics);
      const offTopic = !money || (!decision && label.relevance < MIN_RELEVANCE);
      return { ...item, ...label, topics, decision, hidden: offTopic };
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

  /** M182c «رقم اليوم»: the day's biggest money figure with its story, or null on a quiet day. */
  numberOfDay(lang: NewsLang, now = Date.now()): NumberOfDay | null {
    const dayAgo = now - 24 * 3_600_000;
    let best: { magnitude: number; text: string; item: NewsItem } | null = null;
    for (const item of this.visible(lang)) {
      if (Date.parse(item.publishedAt) < dayAgo || !item.topics.some((topic) => HOME_TOPICS.has(topic))) continue;
      const figure = biggestFigure(`${item.title} ${item.snippet ?? ''}`);
      if (figure && (!best || figure.magnitude > best.magnitude)) best = { ...figure, item };
    }
    return best ? { text: best.text, item: toPublic(best.item) } : null;
  }

  /**
   * M219: what may be shown or pushed at all — not hidden, not a duplicate, and with a photo of its own.
   * M221: and never another country's local story (geo.ts) — the home, «رقم اليوم», the feed and every push read this.
   */
  private shown(item: NewsItem): boolean {
    return !item.hidden && !item.duplicateOf && geoFor(item) !== 'foreign' && this.photoOf(item) !== null;
  }

  /** Shown items, of one language when given. */
  private visible(lang?: NewsLang): NewsItem[] {
    const rows: NewsItem[] = [];
    for (const { item } of this.items.values()) if (this.shown(item) && (!lang || item.lang === lang)) rows.push(item);
    return rows;
  }

  status(): NewsStatus {
    const rows = this.visible();
    const stored = new Map<string, number>();
    for (const { item } of this.items.values()) stored.set(item.sourceId, (stored.get(item.sourceId) ?? 0) + 1);
    return {
      count: this.items.size,
      visible: rows.length,
      visibleByLang: { ar: rows.filter((item) => item.lang === 'ar').length, en: rows.filter((item) => item.lang === 'en').length },
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

  /** What the advisor may know about an item: the source's own words, nothing rewritten (rule 7). */
  contextOf(id: string): { title: string; source: string; snippet: string | null; url: string } | null {
    const entry = this.items.get(id);
    return entry && !entry.item.hidden ? { title: entry.item.title, source: entry.item.sourceName, snippet: entry.item.snippet, url: entry.item.url } : null;
  }

  /** Title and URL for the advisor's screen context («اسأل المستشار عن هذا الخبر»). */
  pageOf(id: string): { title: string; url: string } | null {
    const entry = this.items.get(id);
    return entry ? { title: entry.item.title, url: entry.item.url } : null;
  }

  /**
   * M136: the feed is the day's picks only — the latest two editions, at most two stories per topic — narrowed
   * to the member's interests (or persona defaults; guests see every topic), best first.
   */
  feed(query: ListQuery, audience: Audience): NewsPage {
    // M182: the home carousel — money topics only, the spiciest headlines first, same for everyone.
    if (query.scope === 'home') {
      const now = Date.now();
      const rows = this.currentPicks(query.lang ?? 'ar', now)
        .filter((pick) => pick.item.topics.some((topic) => HOME_TOPICS.has(topic)))
        .map((pick) => ({ item: pick.item, score: scoreOf(pick.item, HOME_TOPICS as Set<TopicKey>, now) + (this.boosts.get(pick.item.sourceId) ?? 0) + sparkOf(pick.item) }))
        .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt))
        .map(({ item }) => item);
      return paginate(rows, query, this.updatedAt, false);
    }
    const interests = audience.prefs?.topics.length ? audience.prefs.topics : this.suggestedTopics(audience.persona);
    // M166: the base sections (crypto, gold and silver, oil, markets) ride along with whatever he picked.
    const wanted = new Set<TopicKey>(interests.length ? [...interests, ...CORE_TOPICS] : []);
    const now = Date.now();
    const ranked = this.currentPicks(query.lang ?? 'ar', now)
      .map((pick) => ({ item: pick.item, score: scoreOf(pick.item, wanted, now) + (this.boosts.get(pick.item.sourceId) ?? 0) }))
      .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt))
      .map(({ item }) => item);
    // M219: the seven money sections are the whole feed, so everyone sees every pick of the day (the editions
    // already hold a section to two stories a day); the interests only rank. A section chip shows its two.
    const topic = query.topic;
    const rows = topic ? ranked.filter((item) => item.topics.includes(topic)).slice(0, MAX_PER_TOPIC_PER_DAY) : ranked;
    return paginate(rows, query, this.updatedAt, wanted.size > 0);
  }

  /** The picks on show: the latest two editions of this language; before the first edition ever, a live preview of the same rule. */
  private currentPicks(lang: NewsLang, now: number): Array<EditionPick & { item: NewsItem }> {
    const editions = this.picks.editions.slice(0, 2);
    if (!editions.length) return this.choosePicks(lang, now, new Set(), MAX_PER_TOPIC_PER_DAY);
    const rows: Array<EditionPick & { item: NewsItem }> = [];
    for (const edition of editions) {
      for (const pick of edition.picks[lang] ?? []) {
        const item = this.items.get(pick.id)?.item;
        if (item && this.shown(item)) rows.push({ ...pick, item });
      }
    }
    return rows;
  }

  /**
   * At most `perTopic` stories per topic: the fresh stories of the last 24 hours, best first, each placed under
   * the first of its topics that still has room — so a story counts for one topic only.
   */
  private choosePicks(lang: NewsLang, now: number, exclude: Set<string>, perTopic: number): Array<EditionPick & { item: NewsItem }> {
    const dayAgo = now - 24 * 3_600_000;
    const pool = this.visible(lang).filter((item) => Date.parse(item.publishedAt) >= dayAgo && !exclude.has(item.id) && item.topics.length > 0);
    const ranked = pool
      .map((item) => ({ item, score: scoreOf(item, new Set(), now) + (this.boosts.get(item.sourceId) ?? 0) }))
      .sort((a, b) => b.score - a.score || b.item.publishedAt.localeCompare(a.item.publishedAt));
    // A story goes under its most specific topic first (the one fewest fresh stories carry), so «الاقتصاد» never swallows a startup or a sports story.
    const common = new Map<TopicKey, number>();
    for (const { item } of ranked) for (const key of item.topics) common.set(key, (common.get(key) ?? 0) + 1);
    const taken = new Map<TopicKey, number>();
    const picks: Array<EditionPick & { item: NewsItem }> = [];
    for (const { item } of ranked) {
      const own = TOPIC_KEYS.filter((key) => item.topics.includes(key)).sort((a, b) => (common.get(a) ?? 0) - (common.get(b) ?? 0));
      const topic = own.find((key) => (taken.get(key) ?? 0) < perTopic);
      if (!topic) continue;
      taken.set(topic, (taken.get(topic) ?? 0) + 1);
      picks.push({ topic, id: item.id, item });
    }
    return picks;
  }

  /**
   * M219: the editions on show were picked under older rules (every section, photo or not) — pick them again
   * under today's, once. `pushedAt` is kept as it was, so an edition already announced is never announced twice.
   */
  private async repick(now = Date.now()): Promise<void> {
    const onShow = this.picks.editions.slice(0, 2).reverse();
    const own = new Set(onShow.flatMap((edition) => [...edition.picks.ar, ...edition.picks.en].map((pick) => pick.id)));
    const exclude = new Set(this.picks.pickedIds.filter((id) => !own.has(id)));
    for (const edition of onShow) {
      for (const lang of ['ar', 'en'] as const) {
        const picks = this.choosePicks(lang, now, exclude, PICKS_PER_TOPIC_PER_EDITION);
        edition.picks[lang] = picks.map((pick) => ({ topic: pick.topic, id: pick.id }));
        for (const pick of picks) exclude.add(pick.id);
      }
    }
    this.picks.pickedIds = [...exclude].slice(-PICKED_IDS_MAX);
    this.picks.rule = PICKS_RULE;
    await this.deps.kv.set(NEWS_PICKS_KEY, this.picks satisfies PicksState);
  }

  /** M136: fills every edition whose hour has passed today (one story per topic, both languages), then sends the unsent ones. */
  async runEditions(now = Date.now()): Promise<void> {
    try {
      const day = riyadhDay(now);
      const hour = riyadhHour(now);
      let changed = false;
      EDITION_HOURS.forEach((editionHour, index) => {
        const slot = index + 1;
        if (hour < editionHour || this.picks.editions.some((edition) => edition.day === day && edition.slot === slot)) return;
        const exclude = new Set(this.picks.pickedIds);
        const picks: Record<NewsLang, EditionPick[]> = { ar: [], en: [] };
        for (const lang of ['ar', 'en'] as const) {
          for (const pick of this.choosePicks(lang, now, exclude, PICKS_PER_TOPIC_PER_EDITION)) {
            picks[lang].push({ topic: pick.topic, id: pick.id });
            exclude.add(pick.id);
          }
        }
        if (!picks.ar.length && !picks.en.length) return; // nothing fresh yet: the next poll retries this edition
        this.picks.editions.unshift({ day, slot, filledAt: new Date(now).toISOString(), picks, pushedAt: null });
        this.picks.rule = PICKS_RULE;
        this.picks.editions = this.picks.editions.slice(0, 6);
        this.picks.pickedIds = [...this.picks.pickedIds, ...picks.ar.map((pick) => pick.id), ...picks.en.map((pick) => pick.id)].slice(-PICKED_IDS_MAX);
        changed = true;
      });
      if (changed) await this.deps.kv.set(NEWS_PICKS_KEY, this.picks satisfies PicksState);
    } catch (error) {
      this.deps.log.error({ err: error }, 'news editions failed');
    }
  }

  /** The fixed section, newest first, the same for everyone. */
  decisions(query: Omit<ListQuery, 'topic'>): NewsPage {
    const rows = this.visible(query.lang ?? 'ar')
      .filter((item) => item.decision)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return paginate(rows, query, this.updatedAt, false);
  }
}

/**
 * The Arabic feed leads with the official wire, then Saudi outlets. The English feed is «Saudi news from foreign
 * sources» (owner, 2026-09-21): foreign outlets lead there, the official English wire comes last.
 */
function feedTierRank(item: NewsItem): number {
  return item.lang === 'en' ? 4 - tierRank(item.tier) : tierRank(item.tier);
}

function scoreOf(item: NewsItem, wanted: Set<TopicKey>, now: number): number {
  const ageHours = Math.max(0, now - Date.parse(item.publishedAt)) / 3_600_000;
  const recency = 55 * Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_H);
  const interest = item.topics.some((topic) => wanted.has(topic)) ? 25 : 0;
  // M221: Saudi stories lead by a wide margin, then world markets, then the Gulf (geo.ts).
  return feedTierRank(item) * 8 + recency + item.relevance * 0.3 + interest + GEO_BOOST[geoFor(item)];
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
    // Every item carries an image when the source offers one: the article photo, else the source's brand image.
    image: item.image ?? item.brandImage ?? null,
    publishedAt: item.publishedAt,
    source: { id: item.sourceId, name: item.sourceName, tier: item.tier, tierLabel: tierLabel(item.tier, item.lang) },
    topics: item.topics.map((key) => ({ key, label: topicLabel(key, item.lang) })),
    decision: item.decision,
    lang: item.lang,
  };
}
