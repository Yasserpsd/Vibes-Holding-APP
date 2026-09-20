import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { KV } from '../store.js';

/**
 * «رسائل الإدارة»: posts the club's management publishes from the dashboard (M9).
 * Stored as one kv document (`admin:posts`), newest first. Images are URLs (pasted links or uploaded
 * files under `/media/`), video is a YouTube id and/or an uploaded file with an optional poster (M15).
 * A post is a plain message or an event with its date and place (bridge v2); published ones are also handed to the
 * hub (`publish`, see hubSync.ts) so the websites and the assistant learn them at the same moment.
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
    kind: z.enum(['post', 'event']).default('post'),
    event: z.object({ date: eventDate, place: z.string().trim().max(200).default(''), onlineUrl: httpUrl.nullish() }).nullish(),
  })
  .refine((input) => input.kind !== 'event' || Boolean(input.event), 'اكتب موعد الفعالية');
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
  /** How the last hand-over to the hub went; `published` = the hub holds a card for this post. */
  hubSync?: PostHubSync;
};

export type PostKind = 'post' | 'event';
export type PostEvent = { date: string; place: string; onlineUrl: string | null };
export type PostHubSync = { state: 'ok' | 'failed' | 'unsupported'; at: string; error: string | null; published: boolean };

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

  private static videoFile(input: PostInput): Post['video'] {
    return input.videoFile ? { url: input.videoFile.url, poster: input.videoFile.poster ?? null } : null;
  }

  async listAll(): Promise<Post[]> {
    return this.load();
  }

  /** Published posts for the app: pinned first, then newest; `before` pages by publishedAt. */
  async listPublished(limit: number, before?: string): Promise<{ posts: Post[]; more: boolean }> {
    const published = (await this.load()).filter((post) => post.status === 'published');
    const ordered = [...published.filter((post) => post.pinned), ...published.filter((post) => !post.pinned)];
    const from = before ? ordered.filter((post) => !post.pinned && (post.publishedAt ?? '') < before) : ordered;
    return { posts: from.slice(0, limit), more: from.length > limit };
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
      Object.assign(post, { title: input.title, body: input.body, links: input.links, images: input.images, youtubeId, video: PostsService.videoFile(input), pinned: input.pinned, kind: input.kind, event: PostsService.event(input), updatedAt: stamp });
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
}
