import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/news (types.ts, service.ts and routes.ts).
export type SourceTier = 'official' | 'saudi' | 'global';

export type NewsTopic = { key: string; label: string };

export type NewsItem = {
  id: string;
  title: string;
  snippet: string | null;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { id: string; name: string; tier: SourceTier; tierLabel: string };
  topics: NewsTopic[];
  decision: boolean;
  lang: 'ar' | 'en';
};

export type NewsPage = {
  items: NewsItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  updatedAt: string | null;
  personalized: boolean;
};

export type NewsTopics = { topics: NewsTopic[]; decisionsTitle: string };
export type NewsPrefs = { topics: string[]; suggested: string[]; saved: boolean };

const PAGE_SIZE = 20;

export const newsApi = {
  topics: () => apiGet<NewsTopics>('/api/news/topics'),
  feed: (topic: string | undefined, page: number) => apiGet<NewsPage>('/api/news/feed', { topic, page, limit: PAGE_SIZE }),
  decisions: (page: number, limit = PAGE_SIZE) => apiGet<NewsPage>('/api/news/decisions', { page, limit }),
  item: (id: string) => apiGet<{ item: NewsItem }>(`/api/news/${encodeURIComponent(id)}`),
  prefs: () => apiGet<NewsPrefs>('/api/news/prefs'),
  /** `token` lets the signup flow save before the session is stored. */
  savePrefs: (topics: string[], token?: string) =>
    apiRequest<{ topics: string[]; saved: true }>('PUT', '/api/news/prefs', { body: { topics }, ...(token ? { token } : {}) }),
};

export function useNewsTopics() {
  return useQuery({ queryKey: ['news', 'topics'], queryFn: newsApi.topics, staleTime: 60 * 60_000 });
}

/** `who` is part of the key so a login or a change of interests reloads the ranking. */
export function useNewsFeed(topic: string | undefined, who: string) {
  return useInfiniteQuery({
    queryKey: ['news', 'feed', topic ?? '', who],
    queryFn: ({ pageParam }) => newsApi.feed(topic, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });
}

export function useDecisions(limit = PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: ['news', 'decisions', limit],
    queryFn: ({ pageParam }) => newsApi.decisions(pageParam, limit),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });
}

export function useNewsItem(id: string | undefined) {
  return useQuery({
    queryKey: ['news', 'item', id],
    queryFn: () => newsApi.item(id ?? ''),
    enabled: Boolean(id),
  });
}

export function useNewsPrefs(enabled: boolean) {
  return useQuery({ queryKey: ['news', 'prefs'], queryFn: newsApi.prefs, enabled, staleTime: 5 * 60_000 });
}

export function useSaveNewsPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topics: string[]) => newsApi.savePrefs(topics),
    onSuccess: (result) => {
      queryClient.setQueryData<NewsPrefs>(['news', 'prefs'], (current) => ({ topics: result.topics, suggested: current?.suggested ?? [], saved: true }));
      void queryClient.invalidateQueries({ queryKey: ['news', 'feed'] });
    },
  });
}
