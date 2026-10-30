import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// M107: the unified interests — mirrors server/src/interests (types.ts and routes.ts).
export type Interest = { key: string; label: string };

export type InterestsAnswer = {
  interests: Interest[];
  max: number;
  mine: { keys: string[]; other: string } | null;
  saved: boolean;
  suggested: string[];
};

export type SaveInterestsInput = { keys: string[]; other?: string };

export const interestsApi = {
  get: () => apiGet<InterestsAnswer>('/api/interests'),
  /** `token` lets the signup flow save before the session is stored. */
  save: (input: SaveInterestsInput, token?: string) =>
    apiRequest<{ keys: string[]; other: string; saved: true }>('PUT', '/api/me/interests', { body: input, ...(token ? { token } : {}) }),
};

export function useInterests() {
  return useQuery({ queryKey: ['interests'], queryFn: interestsApi.get, staleTime: 5 * 60_000, retry: 3 });
}

export function useSaveInterests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInterestsInput) => interestsApi.save(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['interests'] });
      // The interests feed the news ranking and its prefs, and the Projects Bank «حسب اهتماماتي» filter.
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
