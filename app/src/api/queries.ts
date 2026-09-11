import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet } from './client';
import type { GoldenContent, ProjectsFilters, ProjectsPage, ProjectsSort, PublicProject } from './types';

export const PAGE_SIZE = 20;

export type ProjectsListParams = {
  q: string;
  sort: ProjectsSort;
  sector?: string;
  stage?: string;
};

export function useProjectsList(params: ProjectsListParams) {
  return useInfiniteQuery({
    queryKey: ['projects', params],
    queryFn: ({ pageParam }) =>
      apiGet<ProjectsPage>('/api/projects', { ...params, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => apiGet<{ project: PublicProject }>(`/api/projects/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}

export function useProjectFilters() {
  return useQuery({
    queryKey: ['projects', 'filters'],
    queryFn: () => apiGet<ProjectsFilters>('/api/projects/filters'),
    staleTime: 5 * 60_000,
  });
}

export function useGolden() {
  return useQuery({
    queryKey: ['golden'],
    queryFn: () => apiGet<GoldenContent>('/api/golden'),
    staleTime: 10 * 60_000,
  });
}
