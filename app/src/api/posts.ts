import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

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
  kind?: 'post' | 'event' | 'poll';
  event?: PostEvent | null;
  /**
   * M29: the message reached this member because it is for everyone, for his category, or for him
   * alone — the feed only ever contains what he may read. Older servers send no key: everyone.
   */
  audience?: 'all' | 'persona' | 'member';
  /** M31: the poll block as THIS viewer may see it — counts stay null until he may read them. */
  poll?: Poll | null;
};

/** M31: «استفتاء» — one changeable vote per member until it closes (server: polls/service.ts view). */
export type PollOption = { id: string; label: string; votes: number | null };
export type Poll = {
  options: PollOption[];
  closesAt: string | null;
  closed: boolean;
  resultsVisible: boolean;
  totalVotes: number | null;
  myVote: string | null;
};

export const pollsApi = {
  vote: (postId: string, optionId: string) => apiRequest<{ poll: Poll }>('POST', `/api/posts/${encodeURIComponent(postId)}/vote`, { body: { optionId } }),
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

// M29: the admin composer inside the app (mirrors server /api/admin/app/*; admins only).
export type MessageAudience = { type: 'all' } | { type: 'persona'; persona: 'neutral' | 'entrepreneur' | 'investor' } | { type: 'member'; contactId: number; name: string };
export type MemberHit = { id: number; name: string; email: string; persona: string; personaLabel: string };
export type SentMessage = { post: Post; devices: number; push: { sent: number; failed: number; dropped: number } | null };

export const adminMessagesApi = {
  searchMembers: (q: string) => apiGet<{ members: MemberHit[] }>('/api/admin/app/members', { q }),
  send: (input: { title: string; body: string; audience: MessageAudience }) => apiRequest<SentMessage>('POST', '/api/admin/app/messages', { body: input }),
};
