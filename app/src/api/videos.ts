import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

// Mirrors server/src/videos/service.ts.
export type Video = {
  id: string;
  title: string;
  description: string;
  publishedAt: string | null;
  thumbnail: string;
  url: string;
  blurb: string;
  featuredLabel: string | null;
};

export type VideosPage = {
  title: string;
  intro: string;
  channelUrl: string;
  featuredTitle: string;
  featured: Video[];
  items: Video[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  updatedAt: string | null;
};

const PAGE_SIZE = 20;

export function useVideos() {
  return useInfiniteQuery({
    queryKey: ['videos'],
    queryFn: ({ pageParam }) => apiGet<VideosPage>('/api/videos', { page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    staleTime: 10 * 60_000,
  });
}

export function useVideo(id: string | undefined) {
  return useQuery({
    queryKey: ['video', id],
    queryFn: () => apiGet<{ video: Video }>(`/api/videos/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });
}
