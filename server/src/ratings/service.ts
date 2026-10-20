import { randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { KV } from '../store.js';

/**
 * M116 «تقييمات المشاريع»: stars + comments on Projects Bank projects. Two sources feed the same
 * list — members rating from the app (any signed-in account, membership NOT required) and the
 * owner entering the old meetup feedback by hand from the dashboard (he asked every person's
 * permission to publish name + photo). The public answer carries name, photo, stars and comment
 * ONLY: no contact id, no handle, no way to reach the rater's account (the owner's credibility
 * rule). The dashboard can also pin a displayed star value per project (override) that wins over
 * the computed average, and the projects list gains the «الأعلى تقييمًا» sort built from these
 * numbers.
 */
export const RATINGS_KEY = 'ratings:doc';

export type Review = {
  id: string;
  projectId: number;
  /** Whole stars 1–5. */
  stars: number;
  comment: string;
  /** `member` = rated in the app; `manual` = the owner's hand-entered meetup feedback. */
  source: 'member' | 'manual';
  /** Member reviews only; dashboard eyes only — never in a public answer. */
  contactId: number | null;
  name: string;
  photoUrl: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ManualReviewInput = { name: string; stars: number; comment: string; photoUrl: string };
export type ManualReviewPatch = Partial<ManualReviewInput> & { hidden?: boolean };

/** What the app shows on cards and page headers. `stars` = the override when set, else the average. */
export type RatingSummary = { stars: number | null; count: number };

/** One review as the app sees it (rule: nothing that leads back to the account). */
export type PublicReview = { id: string; name: string; photoUrl: string; stars: number; comment: string; at: string; mine: boolean };

export type AdminRatingRow = { projectId: number; stars: number | null; average: number | null; count: number; hiddenCount: number; override: number | null; latestAt: string | null };

type Doc = { reviews: Review[]; overrides: Record<string, number> };

const COMMENT_MAX = 500;
const NAME_MAX = 80;
const PHOTO_MAX = 500;

function checkStars(stars: number): void {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new RequestError('invalid', 'التقييم من نجمة إلى 5 نجوم');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function publicReview(review: Review, contactId?: number | null): PublicReview {
  return {
    id: review.id,
    name: review.name,
    photoUrl: review.photoUrl,
    stars: review.stars,
    comment: review.comment,
    at: review.createdAt,
    mine: Boolean(contactId && review.contactId === contactId),
  };
}

type Deps = { kv: KV };

export class RatingsService {
  private chain: Promise<unknown> = Promise.resolve();
  /** projectId → summary, kept current on every write: the projects sort reads it synchronously. */
  private summaries = new Map<number, RatingSummary>();

  constructor(private readonly deps: Deps) {}

  private async load(): Promise<Doc> {
    const doc = await this.deps.kv.get<Doc>(RATINGS_KEY);
    return { reviews: doc?.reviews ?? [], overrides: doc?.overrides ?? {} };
  }

  private mutate<T>(change: (doc: Doc) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const doc = await this.load();
      const result = change(doc);
      await this.deps.kv.set(RATINGS_KEY, doc);
      this.recompute(doc);
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** One kv read at boot fills the sync summary cache (buildApp awaits it). */
  async start(): Promise<void> {
    this.recompute(await this.load());
  }

  private recompute(doc: Doc): void {
    const next = new Map<number, { total: number; count: number }>();
    for (const review of doc.reviews) {
      if (review.hidden) continue;
      const entry = next.get(review.projectId) ?? { total: 0, count: 0 };
      entry.total += review.stars;
      entry.count += 1;
      next.set(review.projectId, entry);
    }
    this.summaries = new Map();
    for (const [projectId, { total, count }] of next) {
      this.summaries.set(projectId, { stars: round1(total / count), count });
    }
    for (const [key, stars] of Object.entries(doc.overrides)) {
      const projectId = Number(key);
      const existing = this.summaries.get(projectId);
      this.summaries.set(projectId, { stars, count: existing?.count ?? 0 });
    }
  }

  /** Synchronous: the projects list sorts and decorates with this. */
  summary(projectId: number): RatingSummary {
    return this.summaries.get(projectId) ?? { stars: null, count: 0 };
  }

  async listPublic(projectId: number, contactId?: number | null): Promise<PublicReview[]> {
    const doc = await this.load();
    return doc.reviews
      .filter((review) => review.projectId === projectId && !review.hidden)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((review) => publicReview(review, contactId));
  }

  /** The member's review of this project — one per account, resubmitting updates it. */
  async submit(
    projectId: number,
    who: { contactId: number; name: string; photoUrl: string },
    stars: number,
    comment: string,
    now = Date.now(),
  ): Promise<Review> {
    checkStars(stars);
    const text = comment.trim().slice(0, COMMENT_MAX);
    const stamp = new Date(now).toISOString();
    return this.mutate((doc) => {
      const existing = doc.reviews.find((review) => review.projectId === projectId && review.contactId === who.contactId);
      if (existing) {
        Object.assign(existing, { stars, comment: text, name: who.name, photoUrl: who.photoUrl, updatedAt: stamp });
        return existing;
      }
      const review: Review = {
        id: randomUUID(),
        projectId,
        stars,
        comment: text,
        source: 'member',
        contactId: who.contactId,
        name: who.name.slice(0, NAME_MAX),
        photoUrl: who.photoUrl.slice(0, PHOTO_MAX),
        hidden: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      doc.reviews.push(review);
      return review;
    });
  }

  /** Dashboard: the owner enters an old meetup testimonial by hand. */
  async addManual(projectId: number, input: ManualReviewInput, now = Date.now()): Promise<Review> {
    checkStars(input.stars);
    const name = input.name.trim().slice(0, NAME_MAX);
    if (!name) throw new RequestError('invalid', 'اكتب اسم صاحب التقييم');
    const stamp = new Date(now).toISOString();
    return this.mutate((doc) => {
      const review: Review = {
        id: randomUUID(),
        projectId,
        stars: input.stars,
        comment: input.comment.trim().slice(0, COMMENT_MAX),
        source: 'manual',
        contactId: null,
        name,
        photoUrl: input.photoUrl.trim().slice(0, PHOTO_MAX),
        hidden: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      doc.reviews.push(review);
      return review;
    });
  }

  /** Dashboard edit: hide/show works on any review; the text fields only on hand-entered ones. */
  async adminUpdate(id: string, patch: ManualReviewPatch, now = Date.now()): Promise<Review> {
    if (patch.stars !== undefined) checkStars(patch.stars);
    return this.mutate((doc) => {
      const review = doc.reviews.find((entry) => entry.id === id);
      if (!review) throw new RequestError('not_found', 'التقييم غير موجود', 404);
      if (review.source !== 'manual' && (patch.name !== undefined || patch.stars !== undefined || patch.comment !== undefined || patch.photoUrl !== undefined)) {
        throw new RequestError('member_review', 'تقييم عضو من التطبيق — يمكن إخفاؤه أو حذفه فقط');
      }
      if (patch.name !== undefined) {
        const name = patch.name.trim().slice(0, NAME_MAX);
        if (!name) throw new RequestError('invalid', 'اكتب اسم صاحب التقييم');
        review.name = name;
      }
      if (patch.stars !== undefined) review.stars = patch.stars;
      if (patch.comment !== undefined) review.comment = patch.comment.trim().slice(0, COMMENT_MAX);
      if (patch.photoUrl !== undefined) review.photoUrl = patch.photoUrl.trim().slice(0, PHOTO_MAX);
      if (patch.hidden !== undefined) review.hidden = patch.hidden;
      review.updatedAt = new Date(now).toISOString();
      return review;
    });
  }

  async adminDelete(id: string): Promise<boolean> {
    return this.mutate((doc) => {
      const index = doc.reviews.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      doc.reviews.splice(index, 1);
      return true;
    });
  }

  /** All of one project's reviews for the dashboard (hidden included, contactId included). */
  async adminReviews(projectId: number): Promise<Review[]> {
    const doc = await this.load();
    return doc.reviews.filter((review) => review.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The dashboard's per-project aggregate rows (projects that have any review or an override). */
  async adminOverview(): Promise<AdminRatingRow[]> {
    const doc = await this.load();
    const rows = new Map<number, AdminRatingRow>();
    const touch = (projectId: number): AdminRatingRow => {
      const existing = rows.get(projectId);
      if (existing) return existing;
      const row: AdminRatingRow = { projectId, stars: null, average: null, count: 0, hiddenCount: 0, override: null, latestAt: null };
      rows.set(projectId, row);
      return row;
    };
    const totals = new Map<number, number>();
    for (const review of doc.reviews) {
      const row = touch(review.projectId);
      if (review.hidden) row.hiddenCount += 1;
      else {
        row.count += 1;
        totals.set(review.projectId, (totals.get(review.projectId) ?? 0) + review.stars);
      }
      if (!row.latestAt || review.createdAt > row.latestAt) row.latestAt = review.createdAt;
    }
    for (const [projectId, total] of totals) {
      const row = touch(projectId);
      row.average = round1(total / row.count);
    }
    for (const [key, stars] of Object.entries(doc.overrides)) touch(Number(key)).override = stars;
    for (const row of rows.values()) row.stars = row.override ?? row.average;
    return [...rows.values()].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.count - a.count);
  }

  /** Pins the displayed stars for one project (halves allowed, e.g. 4.5); null clears the pin. */
  async setOverride(projectId: number, stars: number | null): Promise<void> {
    if (stars !== null && (stars < 1 || stars > 5 || Math.round(stars * 2) !== stars * 2)) {
      throw new RequestError('invalid', 'النجوم المثبتة من 1 إلى 5 بخطوة نصف نجمة');
    }
    await this.mutate((doc) => {
      if (stars === null) delete doc.overrides[String(projectId)];
      else doc.overrides[String(projectId)] = stars;
    });
  }
}
