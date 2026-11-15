import { useMemo, useSyncExternalStore } from 'react';

import { useLatestPosts, type Post } from '@/api/posts';
import { loadLargeSetting, loadSetting, saveLargeSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M242 (owner, 2026-11-16: «لما يوصل رسالة من الإدارة ينور تحت هنا… حاجة مهمة جدا في الأبلكيشن»): a management
 * message is UNREAD until the member OPENS it — the old «+N» time mark was cleared by merely entering the tab.
 * Device-local like lib/seen.ts (no server round trip, works for a guest): the ids this device opened, plus a
 * baseline time saved at the first launch of the feature so nobody wakes up to every old message «unread».
 */
const BASELINE_KEY = 'investorsclub.readPosts.since';
const IDS_KEY = 'investorsclub.readPosts.ids';
/** The newest reads that are kept (ids are 36 characters: the list is stored in parts, see saveLargeSetting). */
const KEEP = 300;
/** The feed the unread state is read from: the cache entry the inbox tab and the tab badges already hold. */
export const UNREAD_FEED_LIMIT = 10;

export type ReadState = {
  /** False until the stored state has been read: nothing counts as unread before that (no wrong lights at launch). */
  loaded: boolean;
  baseline: number;
  ids: ReadonlySet<string>;
};

let state: ReadState = { loaded: false, baseline: Number.MAX_SAFE_INTEGER, ids: new Set() };
/** The read ids, newest first: the order that is stored and trimmed. */
let order: string[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function ensureLoaded(): Promise<void> {
  loading ??= (async () => {
    let baseline = Date.now();
    let ids: string[] = [];
    try {
      const [since, raw] = await Promise.all([loadSetting(BASELINE_KEY), loadLargeSetting(IDS_KEY)]);
      const stored = Number(since);
      if (since && Number.isFinite(stored) && stored > 0) baseline = stored;
      // The first launch with this feature: everything published so far is taken as read.
      else void saveSetting(BASELINE_KEY, String(baseline)).catch(() => undefined);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string').slice(0, KEEP);
    } catch {
      // An unreadable list: the baseline still stands, the messages after it read as unread again.
    }
    order = ids;
    state = { loaded: true, baseline, ids: new Set(ids) };
    notify();
  })();
  return loading;
}

// One write at a time: the list is saved in parts, and two interleaved saves would mix them.
let writes: Promise<void> = Promise.resolve();

function persist(): void {
  const snapshot = JSON.stringify(order);
  writes = writes.then(() => saveLargeSetting(IDS_KEY, snapshot)).catch(() => undefined);
}

function addRead(ids: string[]): void {
  // After the stored list is in: a message opened straight from a push must not overwrite it.
  void ensureLoaded().then(() => {
    const fresh = [...new Set(ids)].filter((id) => id && !state.ids.has(id));
    if (fresh.length === 0) return;
    order = [...fresh, ...order].slice(0, KEEP);
    state = { ...state, ids: new Set(order) };
    notify();
    persist();
  });
}

/** The member opened this message. */
export function markPostRead(id: string): void {
  addRead([id]);
}

/** «تعليم الكل كمقروء». */
export function markAllPostsRead(ids: string[]): void {
  addRead(ids);
}

/** Unread = published after the baseline and never opened on this device. */
export function isPostUnread(post: Pick<Post, 'id' | 'publishedAt'>, read: ReadState): boolean {
  if (!read.loaded || !post.publishedAt) return false;
  const at = Date.parse(post.publishedAt);
  return Number.isFinite(at) && at > read.baseline && !read.ids.has(post.id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The read state, for a row that decides its own dot (`isPostUnread(post, read)`). */
export function useReadPosts(): ReadState {
  void ensureLoaded();
  return useSyncExternalStore(subscribe, () => state);
}

/** The unread management messages, newest first, from the feed the app already holds. */
export function useUnreadPosts(): Post[] {
  const read = useReadPosts();
  const posts = useLatestPosts(UNREAD_FEED_LIMIT).data?.posts;
  return useMemo(
    () => (posts ?? []).filter((post) => isPostUnread(post, read)).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')),
    [posts, read],
  );
}
