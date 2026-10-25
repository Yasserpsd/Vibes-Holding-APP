import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';
import type { GoldenContent, GoldenOffer, ProjectAccess, ProjectBrief, ProjectReview, ProjectReviews, ProjectUnlockResult, ProjectsBalance, ProjectsFilters, ProjectsPage, ProjectsSort, PublicProject } from './types';

export const PAGE_SIZE = 20;

export type ProjectsListParams = {
  q: string;
  sort: ProjectsSort;
  sector?: string;
  stage?: string;
  /** M107 «حسب اهتماماتي»: '1' keeps only the projects matching my saved interests. */
  mine?: '1';
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

/** M99c: the member's Projects Bank wallet — his balance and how many projects he opened. */
export type ProjectsWallet = { isMember: boolean; balance: ProjectsBalance | null; unlockedCount: number };

export function useProjectsWallet(account: string | null) {
  return useQuery({
    queryKey: ['projects-wallet', account ?? ''],
    queryFn: () => apiGet<ProjectsWallet>('/api/projects/wallet'),
    enabled: Boolean(account),
    staleTime: 60_000,
    retry: false,
  });
}

export const projectsApi = {
  unlock: (id: string) => apiRequest<ProjectUnlockResult>('POST', `/api/projects/${encodeURIComponent(id)}/unlock`, { body: {} }),
  // M116: rate a project (any signed-in account; resubmitting updates the same review).
  review: (id: string, stars: number, comment: string) =>
    apiRequest<{ ok: true; review: ProjectReview; summary: ProjectReviews['summary'] }>('POST', `/api/projects/${encodeURIComponent(id)}/reviews`, { body: { stars, comment } }),
};

/** M116 «تقييمات المشاريع»: public like the project; `mine` marks the signed-in account's own review. */
export function useProjectReviews(id: string | undefined, account: string | null) {
  return useQuery({
    // The account in the key: `mine` flips when another account signs in.
    queryKey: ['project-reviews', id, account ?? ''],
    queryFn: () => apiGet<ProjectReviews>(`/api/projects/${encodeURIComponent(id ?? '')}/reviews`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** Icons pass: the bank's headline number alone — the lightest possible page (one item) for its `total`. */
export function useProjectsCount() {
  return useQuery({
    queryKey: ['projects', 'count'],
    queryFn: () => apiGet<ProjectsPage>('/api/projects', { q: '', sort: 'latest', page: 1, limit: 1 }),
    staleTime: 5 * 60_000,
    select: (page) => page.total,
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

/** The native offer page of one golden company (§5.1): blocks pulled from its web page by the server. */
export function useGoldenOffer(code: string | undefined) {
  return useQuery({
    queryKey: ['golden', 'offer', code],
    queryFn: () => apiGet<GoldenOffer>(`/api/golden/offer/${encodeURIComponent(code ?? '')}`),
    enabled: Boolean(code),
    staleTime: 10 * 60_000,
  });
}

/** «سجّل اهتمامك» on the offer page: the management is mailed, nothing leaves the app. */
export function sendGoldenInterest(code: string, body: { name: string; phone: string; note: string }) {
  return apiRequest<{ ok: boolean }>('POST', `/api/golden/offer/${encodeURIComponent(code)}/interest`, { body });
}

/** The in-app page for a golden company's web offer link, when the link belongs to one (§5.1: never leave the app). */
export function goldenCodeForUrl(content: GoldenContent | undefined, url: string | null): string | null {
  if (!content || !url) return null;
  const hostOf = (value: string): string | null => {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };
  const host = hostOf(url);
  if (!host) return null;
  const match = [content.umbrella, ...content.companies].find((company) => hostOf(company.offerUrl) === host);
  return match?.code ?? null;
}
