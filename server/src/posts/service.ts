import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Persona } from '../auth/service.js';
import type { KV } from '../store.js';

/**
 * «رسائل الإدارة»: posts the club's management publishes from the dashboard (M9).
 * Stored as one kv document (`admin:posts`), newest first. Images are URLs (pasted links or uploaded
 * files under `/media/`), video is a YouTube id and/or an uploaded file with an optional poster (M15).
 * A post is a plain message or an event with its date and place (bridge v2); published ones are also handed to the
 * hub (`publish`, see hubSync.ts) so the websites and the assistant learn them at the same moment.
 * M29: a post carries an audience — everyone, one persona, or one member — and the feed shows each
 * viewer only what is addressed to him; targeted posts stay inside the app (never handed to the hub).
 */
export const POSTS_KEY = 'admin:posts';
const MAX_POSTS = 500;

const httpUrl = z
  .string()
  .trim()
  .max(600)
  .refine((value) => /^https?:\/\//i.test(value) && URL.canParse(value), 'رابط غير صالح');

/** An event's day (`2026-10-05`) or exact time (`2026-10-05T19:30:00+03:00`). */
const eventDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, 'تاريخ الفعالية غير صالح')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'تاريخ الفعالية غير صالح');

/** M31: a poll's options as the dashboard sends them; an option keeps its id across edits so votes survive. */
const pollInputSchema = z.object({
  options: z
    .array(z.object({ id: z.string().trim().max(40).optional(), label: z.string().trim().min(1, 'اكتب نص الخيار').max(140) }))
    .min(2, 'استفتاء يحتاج خيارين على الأقل')
    .max(20, 'حتى 20 خيارًا في الاستفتاء'),
  closesAt: eventDate.nullish(),
  resultsVisible: z.boolean().default(true),
});

/** M29: who a message is for. `name` on a member audience is only a display label for the dashboard. */
export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('persona'), persona: z.enum(['neutral', 'entrepreneur', 'investor']) }),
  z.object({ type: z.literal('member'), contactId: z.coerce.number().int().positive(), name: z.string().trim().max(120).default('') }),
]);

export const postInputSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    body: z.string().trim().max(6000).default(''),
    links: z.array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl })).max(8).default([]),
    images: z.array(httpUrl).max(10).default([]),
    video: z.string().trim().max(300).nullish(),
    videoFile: z.object({ url: httpUrl, poster: httpUrl.nullish() }).nullish(),
    status: z.enum(['draft', 'published']).default('draft'),
    pinned: z.boolean().default(false),
    kind: z.enum(['post', 'event', 'poll', 'popup']).default('post'),
    event: z.object({ date: eventDate, place: z.string().trim().max(200).default(''), onlineUrl: httpUrl.nullish() }).nullish(),
    poll: pollInputSchema.nullish(),
    /** M232: a popup's last day or moment; absent = it shows until it is unpublished. */
    popup: z.object({ until: eventDate.nullish() }).nullish(),
    audience: audienceSchema.default({ type: 'all' }),
    /** M43: the dashboard's own English wording; absent or empty = the automatic translation stands. */
    english: z.object({ title: z.string().trim().max(140).default(''), body: z.string().trim().max(6000).default('') }).nullish(),
  })
  .refine((input) => input.kind !== 'event' || Boolean(input.event), 'اكتب موعد الفعالية')
  .refine((input) => input.kind !== 'poll' || Boolean(input.poll), 'اكتب خيارات الاستفتاء');
export type PostInput = z.infer<typeof postInputSchema>;

export type Post = {
  id: string;
  title: string;
  body: string;
  links: { label: string; url: string }[];
  images: string[];
  youtubeId: string | null;
  /** An uploaded video; posts stored before M15 have no such key. */
  video?: { url: string; poster: string | null } | null;
  status: 'draft' | 'published';
  pinned: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  notifiedAt: string | null;
  /** Posts stored before bridge v2 have neither key: they are plain posts. */
  kind?: PostKind;
  event?: PostEvent | null;
  /** M29: posts stored before it have no key and are for everyone. */
  audience?: PostAudience;
  /** M31: the poll behind a `kind: 'poll'` post; votes live in their own document (polls/service.ts). */
  poll?: PostPoll | null;
  /** M232: the window of a `kind: 'popup'` post — it opens once per device, over the app, until `until`. */
  popup?: PostPopup | null;
  /** How the last hand-over to the hub went; `published` = the hub holds a card for this post. */
  hubSync?: PostHubSync;
  /** M43: the English of the owner's words, written once by AI and editable from the dashboard. */
  en?: PostEnglish | null;
  /** False once the owner edited the English himself: automatic retranslation then stops. */
  enAuto?: boolean;
};

/** M180: `links`/`options` follow the post's link and poll-option order; `hash` = the Arabic they were written from. */
export type PostEnglish = { title: string; body: string; place: string | null; links?: string[]; options?: string[]; hash?: string };

export type PostKind = 'post' | 'event' | 'poll' | 'popup';
export type PostPopup = { until: string | null };

/** M232: a popup past its last moment is over; a bare day lasts until that day ends in Riyadh. */
export function popupOver(popup: PostPopup | null | undefined, now = Date.now()): boolean {
  if (!popup?.until) return false;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(popup.until) ? Date.parse(`${popup.until}T23:59:59+03:00`) : Date.parse(popup.until);
  return !Number.isNaN(end) && end <= now;
}
export type PostEvent = { date: string; place: string; onlineUrl: string | null };
export type PostPollOption = { id: string; label: string };
export type PostPoll = { options: PostPollOption[]; closesAt: string | null; resultsVisible: boolean };

/** M31: a poll after its closing moment takes no more votes; without one it stays open. */
export function pollClosed(poll: PostPoll, now = Date.now()): boolean {
  return poll.closesAt !== null && Date.parse(poll.closesAt) <= now;
}
export type PostAudience = { type: 'all' } | { type: 'persona'; persona: Persona } | { type: 'member'; contactId: number; name: string };
export type PostHubSync = { state: 'ok' | 'failed' | 'unsupported'; at: string; error: string | null; published: boolean };

/**
 * Who is reading the feed; null is a guest. M232: `honorary` = «عضوية شرفية» — such a member is kept apart from
 * everything the management sends, whatever his category; `name` / `nameEn` greet the reader of a message by name.
 */
export type PostViewer = { contactId: number; persona: string; honorary?: boolean; name?: string; nameEn?: string } | null;

export function audienceOf(post: Pick<Post, 'audience'>): PostAudience {
  return post.audience ?? { type: 'all' };
}

/** M29: a post for everyone is for guests too; a targeted one only for its persona or its member. */
export function canSee(post: Pick<Post, 'audience'>, viewer: PostViewer): boolean {
  const audience = audienceOf(post);
  // M232 (owner: «عزل كامل»): an honorary member reads nothing the management sends — not even what is for everyone.
  if (viewer?.honorary) return false;
  if (audience.type === 'all') return true;
  if (!viewer) return false;
  return audience.type === 'persona' ? viewer.persona === audience.persona : viewer.contactId === audience.contactId;
}

/** Every media URL a post points at (images, uploaded video, poster), ours or not. */
export function postMediaUrls(post: Pick<Post, 'images' | 'video'>): string[] {
  return [...post.images, ...(post.video ? [post.video.url, ...(post.video.poster ? [post.video.poster] : [])] : [])];
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare id or any usual YouTube link; null when the value is not a YouTube video. */
export function parseYoutubeId(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (YOUTUBE_ID.test(raw)) return raw;
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    id = url.searchParams.get('v') ?? (['embed', 'shorts', 'live'].includes(parts[0] ?? '') ? (parts[1] ?? null) : null);
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export class InvalidVideoError extends Error {}

export class PostsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KV) {}

  private async load(): Promise<Post[]> {
    return (await this.kv.get<{ posts: Post[] }>(POSTS_KEY))?.posts ?? [];
  }

  private mutate<T>(change: (posts: Post[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const posts = await this.load();
      const result = change(posts);
      posts.sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
      await this.kv.set(POSTS_KEY, { posts: posts.slice(0, MAX_POSTS) });
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private static video(input: PostInput): string | null {
    const youtubeId = parseYoutubeId(input.video);
    if (input.video && input.video.trim() && !youtubeId) throw new InvalidVideoError('رابط الفيديو يجب أن يكون من يوتيوب');
    return youtubeId;
  }

  private static event(input: PostInput): PostEvent | null {
    return input.kind === 'event' && input.event ? { date: input.event.date, place: input.event.place, onlineUrl: input.event.onlineUrl ?? null } : null;
  }

  /**
   * M31: builds the stored poll. An edited option keeps its stored id (its votes survive); a new
   * option gets a fresh random id, never a reused one, so a removed option's votes cannot
   * resurrect under a newcomer.
   */
  private static poll(input: PostInput, before: Post | null): PostPoll | null {
    if (input.kind !== 'poll' || !input.poll) return null;
    const kept = new Set((before?.poll?.options ?? []).map((option) => option.id));
    const used = new Set<string>();
    const options = input.poll.options.map((option) => {
      const id = option.id && kept.has(option.id) && !used.has(option.id) ? option.id : randomUUID().slice(0, 8);
      used.add(id);
      return { id, label: option.label };
    });
    return { options, closesAt: input.poll.closesAt ?? null, resultsVisible: input.poll.resultsVisible };
  }

  private static popup(input: PostInput): PostPopup | null {
    return input.kind === 'popup' ? { until: input.popup?.until ?? null } : null;
  }

  private static videoFile(input: PostInput): Post['video'] {
    return input.videoFile ? { url: input.videoFile.url, poster: input.videoFile.poster ?? null } : null;
  }

  async listAll(): Promise<Post[]> {
    return this.load();
  }

  /** Published posts the viewer may read: pinned first, then newest; `before` pages by publishedAt. */
  async listPublished(limit: number, before?: string, viewer: PostViewer = null): Promise<{ posts: Post[]; more: boolean }> {
    // M232: a popup is not a message in the inbox; it opens by itself (listPopups).
    const published = (await this.load()).filter((post) => post.status === 'published' && post.kind !== 'popup' && canSee(post, viewer));
    const ordered = [...published.filter((post) => post.pinned), ...published.filter((post) => !post.pinned)];
    const from = before ? ordered.filter((post) => !post.pinned && (post.publishedAt ?? '') < before) : ordered;
    return { posts: from.slice(0, limit), more: from.length > limit };
  }

  /** M232: the popups this viewer may see right now, newest first. */
  async listPopups(viewer: PostViewer = null, now = Date.now()): Promise<Post[]> {
    return (await this.load()).filter((post) => post.status === 'published' && post.kind === 'popup' && !popupOver(post.popup, now) && canSee(post, viewer));
  }

  async get(id: string): Promise<Post | null> {
    return (await this.load()).find((post) => post.id === id) ?? null;
  }

  async create(input: PostInput, author: string | null, now = new Date()): Promise<Post> {
    const youtubeId = PostsService.video(input);
    const stamp = now.toISOString();
    const post: Post = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      links: input.links,
      images: input.images,
      youtubeId,
      video: PostsService.videoFile(input),
      status: input.status,
      pinned: input.pinned,
      author,
      createdAt: stamp,
      updatedAt: stamp,
      publishedAt: input.status === 'published' ? stamp : null,
      notifiedAt: null,
      kind: input.kind,
      event: PostsService.event(input),
      poll: PostsService.poll(input, null),
      popup: PostsService.popup(input),
      audience: input.audience,
    };
    await this.mutate((posts) => void posts.push(post));
    return post;
  }

  async update(id: string, input: PostInput, now = new Date()): Promise<Post | null> {
    const youtubeId = PostsService.video(input);
    return this.mutate((posts) => {
      const post = posts.find((entry) => entry.id === id);
      if (!post) return null;
      const stamp = now.toISOString();
      Object.assign(post, { title: input.title, body: input.body, links: input.links, images: input.images, youtubeId, video: PostsService.videoFile(input), pinned: input.pinned, kind: input.kind, event: PostsService.event(input), poll: PostsService.poll(input, post), popup: PostsService.popup(input), audience: input.audience, updatedAt: stamp });
      if (input.status === 'published' && !post.publishedAt) post.publishedAt = stamp;
      post.status = input.status;
      return post;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((posts) => {
      const index = posts.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      posts.splice(index, 1);
      return true;
    });
  }

  async markHubSync(id: string, hubSync: PostHubSync): Promise<void> {
    await this.mutate((posts) => {
      const post = posts.find((entry) => entry.id === id);
      if (post) post.hubSync = hubSync;
    });
  }

  async markNotified(id: string, now = new Date()): Promise<void> {
    await this.mutate((posts) => {
      const post = posts.find((entry) => entry.id === id);
      if (post) post.notifiedAt = now.toISOString();
    });
  }

  /** M43: the English of the post — `auto: false` records the owner's own wording and stops retranslation. */
  async setEnglish(id: string, en: PostEnglish | null, auto: boolean): Promise<void> {
    await this.mutate((posts) => {
      const post = posts.find((entry) => entry.id === id);
      if (!post) return;
      post.en = en;
      post.enAuto = auto;
    });
  }
}
