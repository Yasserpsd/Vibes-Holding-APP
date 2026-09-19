import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

/** «رسائل الإدارة»: a post the club's management published from the dashboard (server: `publicPost`). */
export type Post = {
  id: string;
  title: string;
  body: string;
  links: { label: string; url: string }[];
  images: string[];
  youtubeId: string | null;
  pinned: boolean;
  publishedAt: string | null;
};

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
