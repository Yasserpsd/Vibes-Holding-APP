import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

/** An event's day (`2026-10-05`) or exact time (ISO), where it happens and the link for attending online. */
export type PostEvent = { date: string; place: string; onlineUrl: string | null };

/** «رسائل الإدارة»: a post the club's management published from the dashboard (server: `publicPost`). */
export type Post = {
  id: string;
  title: string;
  body: string;
  links: { label: string; url: string }[];
  images: string[];
  youtubeId: string | null;
  /** A video uploaded from the dashboard. Older servers and posts send no `video` key: treat it as null. */
  video?: { url: string; poster: string | null } | null;
  pinned: boolean;
  publishedAt: string | null;
  /** Bridge v2: a plain message or an event. Older servers send neither key: treat the post as a plain message. */
  kind?: 'post' | 'event';
  event?: PostEvent | null;
};

/** The event's details when the post is one. */
export function eventOf(post: Post): PostEvent | null {
  return post.kind === 'event' && post.event?.date ? post.event : null;
}

export type PostsPage = { posts: Post[]; more: boolean };

const PAGE_SIZE = 10;

/** The newest posts for the home block (pinned first, as the server orders them). */
export function useLatestPosts(limit = 3) {
  return useQuery({
    queryKey: ['posts', 'latest', limit],
    queryFn: () => apiGet<PostsPage>('/api/posts', { limit }),
    staleTime: 2 * 60_000,
  });
}

/**
 * All posts, paged. The server returns pinned posts on the first page only and pages the rest by
 * `before` = the publish time of the last non-pinned post.
 */
export function usePosts() {
  return useInfiniteQuery({
    queryKey: ['posts', 'all'],
    queryFn: ({ pageParam }) => apiGet<PostsPage>('/api/posts', { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (lastPage) => {
      if (!lastPage.more) return undefined;
      const last = [...lastPage.posts].reverse().find((post) => !post.pinned && post.publishedAt);
      return last?.publishedAt ?? undefined;
    },
    staleTime: 2 * 60_000,
  });
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: ['post', id],
    queryFn: () => apiGet<{ post: Post }>(`/api/posts/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}
