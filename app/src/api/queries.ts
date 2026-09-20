import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';
import type { GoldenContent, ProjectAccess, ProjectBrief, ProjectUnlockResult, ProjectsFilters, ProjectsPage, ProjectsSort, PublicProject } from './types';

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

/** «ملخص المستشار». The first call of a project can take up to 25 s on the server; afterwards it is cached there by content. */
export function useProjectBrief(id: string | undefined) {
  return useQuery({
    queryKey: ['project-brief', id],
    queryFn: () => apiGet<ProjectBrief>(`/api/projects/${encodeURIComponent(id ?? '')}/brief`),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
    // The page works without the brief: no retry storm against a slow first build.
    retry: false,
  });
}

export const projectAccessKey = (id: string | undefined, account: string) => ['project-access', id, account] as const;

/**
 * What this member may do with the project, and the founder's contact data once he unlocked it (rule 4).
 * Keyed by account, never kept after the page closes (`gcTime: 0`), and removed on sign-out (AuthProvider).
 */
export function useProjectAccess(id: string | undefined, account: string | null) {
  return useQuery({
    queryKey: projectAccessKey(id, account ?? ''),
    queryFn: () => apiGet<ProjectAccess>(`/api/projects/${encodeURIComponent(id ?? '')}/access`),
    enabled: Boolean(id) && Boolean(account),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export const projectsApi = {
  unlock: (id: string) => apiRequest<ProjectUnlockResult>('POST', `/api/projects/${encodeURIComponent(id)}/unlock`, { body: {} }),
};

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
