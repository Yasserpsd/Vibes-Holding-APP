import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { Config } from '../config.js';
import { isInterestKey, matchesInterests } from '../interests/types.js';
import type { KV } from '../store.js';
import { fetchFeedItems } from './feed.js';
import { pageUrlOf, toPublicProject } from './mapper.js';
import { STAGES } from './stage.js';
import { normalizeForSearch } from './text.js';
import type {
  FeedSnapshot,
  FilterOption,
  ProjectsFilters,
  ProjectsPage,
  ProjectsQuery,
  ProjectsSort,
  PublicProject,
} from './types.js';

export const SNAPSHOT_KEY = 'projectsBank:snapshot';

export const SORT_LABELS: Record<ProjectsSort, string> = {
  // M242 (owner, 2026-11-16): «اكتشف» leads — the bank opens on the order that changes every day.
  // (M116 had «الأعلى تقييمًا» first; with two ratings in the whole bank its first cards never changed.)
  discover: 'اكتشف',
  top: 'الأعلى تقييمًا',
  latest: 'الأحدث',
  views: 'الأكثر مشاهدة',
  golden: 'المشاريع الذهبية',
};

/**
 * M242: the day of the bank's rotating order — the Riyadh calendar day as a number, so the order turns at
 * 00:00 Riyadh (21:00 UTC). One day and no shorter: the adviser's daily tip names a project from this order.
 */
export function rotationDay(now = Date.now()): number {
  return Math.floor((now + 3 * 3_600_000) / 86_400_000);
}

/** True when `lastMovedMs` (the `projects` sync version) falls on an earlier rotation day than `now`: the order has turned since. */
export function rotationTurned(lastMovedMs: number, now = Date.now()): boolean {
  return rotationDay(lastMovedMs) < rotationDay(now);
}

/**
 * The day's hand: a stable shuffle of these projects for one rotation day. The same day gives the same
 * order (so paging stays consistent within the day); another day or another `salt` gives a different one.
 */
export function dayOrder(projects: PublicProject[], day: number, salt = 0): (a: PublicProject, b: PublicProject) => number {
  const ranks = new Map(projects.map((project) => [project.id, hash32(project.id * 2654435761 + day + salt)]));
  const rank = (project: PublicProject): number => ranks.get(project.id) ?? 0;
  return (a, b) => rank(a) - rank(b) || b.id - a.id;
}

/** «الأعلى تقييمًا» deals its unrated tail with a different hand from «اكتشف». */
const TOP_SALT = 7919;

type IndexedProject = { project: PublicProject; search: string };

type RatingLookup = (id: number) => { stars: number | null; count: number };

type Deps = {
  kv: KV;
  config: Config;
  log: FastifyBaseLogger;
  /** Called when a refresh brought different content (/api/sync). */ onChange?: () => void;
  /** M116: the ratings summary, for the «الأعلى تقييمًا» sort. */ ratingOf?: RatingLookup;
};

/** Keeps the public projects in memory, refreshed from the feed on a schedule. */
export class ProjectsService {
  private items: IndexedProject[] = [];
  private fetchedAt: string | null = null;
  private lastError: string | null = null;
  private pageUrls = new Map<number, string>();
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private contentHash: string | null = null;

  constructor(private readonly deps: Deps) {}

  async start(): Promise<void> {
    const snapshot = await this.deps.kv.get<FeedSnapshot>(SNAPSHOT_KEY);
    if (snapshot) {
      this.load(snapshot.projects, snapshot.fetchedAt, snapshot.pageUrls ?? {});
      this.contentHash = hashOf(snapshot.projects);
    }

    if (!this.deps.config.PB_FEED_KEY) {
      this.deps.log.warn('PB_FEED_KEY is not set: Projects Bank sync is disabled');
      return;
    }
    void this.refresh();
    const intervalMs = this.deps.config.PB_REFRESH_MINUTES * 60_000;
    this.timer = setInterval(() => void this.refresh(), intervalMs);
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

  private async doRefresh(): Promise<void> {
    try {
      const rawItems = await fetchFeedItems(this.deps.config);
      const projects: PublicProject[] = [];
      const pageUrls: Record<string, string> = {};
      for (const item of rawItems) {
        const project = toPublicProject(item);
        if (!project) continue;
        projects.push(project);
        const pageUrl = pageUrlOf(item);
        if (pageUrl) pageUrls[String(project.id)] = pageUrl;
      }
      const fetchedAt = new Date().toISOString();
      this.load(projects, fetchedAt, pageUrls);
      const contentHash = hashOf(projects);
      if (this.contentHash !== null && this.contentHash !== contentHash) this.deps.onChange?.();
      this.contentHash = contentHash;
      await this.deps.kv.set(SNAPSHOT_KEY, { projects, fetchedAt, pageUrls } satisfies FeedSnapshot);
      this.lastError = null;
      this.deps.log.info({ count: projects.length, skipped: rawItems.length - projects.length }, 'Projects Bank feed refreshed');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'unknown error';
      this.deps.log.error({ reason: this.lastError }, 'Projects Bank feed refresh failed');
    }
  }

  private load(projects: PublicProject[], fetchedAt: string, pageUrls: Record<string, string>): void {
    this.items = projects.map((project) => ({ project, search: buildSearchText(project) }));
    this.fetchedAt = fetchedAt;
    this.pageUrls = new Map(Object.entries(pageUrls).map(([id, url]) => [Number(id), url]));
  }

  /** The project's public web page, for the advisor's screen context only. */
  pageUrl(id: number): string | null {
    return this.pageUrls.get(id) ?? null;
  }

  status(): { count: number; updatedAt: string | null; lastError: string | null } {
    return { count: this.items.length, updatedAt: this.fetchedAt, lastError: this.lastError };
  }

  /** Every public project, for the brief's choice of comparable projects. */
  all(): PublicProject[] {
    return this.items.map((item) => item.project);
  }

  get(id: number): PublicProject | null {
    return this.items.find((item) => item.project.id === id)?.project ?? null;
  }

  list(query: ProjectsQuery): ProjectsPage {
    let rows = this.items;
    if (query.sector) rows = rows.filter((row) => row.project.sector?.slug === query.sector);
    if (query.stage) rows = rows.filter((row) => row.project.stage?.slug === query.stage);
    // M107 «حسب اهتماماتي»: the member's interests matched against the sector name and the title.
    if (query.forInterests?.length) {
      const keys = query.forInterests.filter(isInterestKey);
      rows = rows.filter((row) => matchesInterests(keys, `${row.project.sector?.name ?? ''} ${row.project.title}`));
    }
    if (query.q) {
      const terms = normalizeForSearch(query.q).split(' ').filter(Boolean);
      rows = rows.filter((row) => terms.every((term) => row.search.includes(term)));
    }
    // M242: the rotating orders follow the day the caller names (a later page of a list that began before
    // midnight), else today's. The answer says which day it was dealt under.
    const day = query.day ?? rotationDay();
    const sorted = sortProjects(rows.map((row) => row.project), query.sort, this.deps.ratingOf, day);
    const start = (query.page - 1) * query.limit;
    const items = sorted.slice(start, start + query.limit);
    return {
      items,
      page: query.page,
      limit: query.limit,
      total: sorted.length,
      hasMore: start + items.length < sorted.length,
      updatedAt: this.fetchedAt,
      day,
    };
  }

  filters(): ProjectsFilters {
    const sectors = new Map<string, FilterOption>();
    const stages = new Map<string, number>();
    for (const { project } of this.items) {
      if (project.sector) countTerm(sectors, project.sector);
      if (project.stage) stages.set(project.stage.slug, (stages.get(project.stage.slug) ?? 0) + 1);
    }
    return {
      sectors: sortOptions(sectors),
      // The five steps in their own order, declared and estimated together; a step without projects is not offered.
      stages: STAGES.filter((step) => stages.has(step.key)).map((step) => ({ slug: step.key, name: step.label, count: stages.get(step.key) ?? 0 })),
      sorts: (Object.keys(SORT_LABELS) as ProjectsSort[]).map((key) => ({ key, label: SORT_LABELS[key] })),
      updatedAt: this.fetchedAt,
    };
  }
}

/** The view counter moves on every visit: it is not a change worth a refetch in the app. */
function hashOf(projects: PublicProject[]): string {
  return createHash('sha256').update(JSON.stringify(projects.map((project) => ({ ...project, viewsCount: 0 })))).digest('hex');
}

function buildSearchText(project: PublicProject): string {
  return normalizeForSearch(
    [
      project.number,
      project.title,
      project.titleEn,
      project.companyName,
      project.companyNameEn,
      project.founderName,
      project.founderNameEn,
      project.sector?.name,
      project.stage?.name,
      project.excerpt,
      project.excerptEn,
      project.details,
      project.detailsEn,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function countTerm(map: Map<string, FilterOption>, term: { slug: string; name: string }): void {
  const existing = map.get(term.slug);
  if (existing) existing.count += 1;
  else map.set(term.slug, { ...term, count: 1 });
}

function sortOptions(map: Map<string, FilterOption>): FilterOption[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'));
}

function byLatest(a: PublicProject, b: PublicProject): number {
  return (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || b.id - a.id;
}

function sortProjects(projects: PublicProject[], sort: ProjectsSort, ratingOf: RatingLookup | undefined, day: number): PublicProject[] {
  const copy = [...projects];
  switch (sort) {
    // M116: the rated projects first (stars, then how many rated).
    // M242: equal ratings and the whole unrated tail follow the day's hand, no longer the last-edit date:
    // with two ratings in the bank the tail IS the list, and it stood still for weeks.
    case 'top': {
      const hand = dayOrder(copy, day, TOP_SALT);
      if (!ratingOf) return copy.sort(hand);
      return copy.sort((a, b) => {
        const ra = ratingOf(a.id);
        const rb = ratingOf(b.id);
        return (rb.stars ?? 0) - (ra.stars ?? 0) || rb.count - ra.count || hand(a, b);
      });
    }
    case 'views':
      return copy.sort((a, b) => b.viewsCount - a.viewsCount || byLatest(a, b));
    case 'golden':
      return copy.sort(
        (a, b) =>
          Number(b.isGolden) - Number(a.isGolden) ||
          (a.featuredOrder ?? Number.MAX_SAFE_INTEGER) - (b.featuredOrder ?? Number.MAX_SAFE_INTEGER) ||
          byLatest(a, b),
      );
    case 'discover':
      // Stable shuffle that changes once a Riyadh day (M242: it turned at 03:00 Riyadh, the UTC day, before).
      return copy.sort(dayOrder(copy, day));
    case 'latest':
    default:
      return copy.sort(byLatest);
  }
}

function hash32(input: number): number {
  let value = input >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}
