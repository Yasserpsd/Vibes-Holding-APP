import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// M11 «شخصية ومسيرة» — mirrors server/src/profiles/routes.ts.
export type PersonLink = { label: string; url: string };
export type Person = { id: string; name: string; title: string; company: string; photo: string | null };
export type PersonFull = Person & { bio: string; milestones: string[]; links: PersonLink[] };
export type PeopleAnswer = { intro: string; people: Person[] };

export type ProfileStatus = 'pending' | 'approved' | 'rejected';
export type MyProfileFields = { name: string; title: string; company: string; bio: string; milestones: string[]; links: PersonLink[]; photo: string | null };
export type MyProfile = { id: string; status: ProfileStatus; fields: MyProfileFields; draft: MyProfileFields | null; note: string };
export type ApplyInput = { title: string; company: string; bio: string; milestones: string[]; links: PersonLink[] };

export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: () => apiGet<PeopleAnswer>('/api/people'),
    staleTime: 60_000,
  });
}

export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => apiGet<{ person: PersonFull }>(`/api/people/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useMyProfile(enabled: boolean) {
  return useQuery({
    queryKey: ['profile', 'mine'],
    queryFn: () => apiGet<{ intro: string; profile: MyProfile | null }>('/api/profiles/me'),
    enabled,
  });
}

export function useApplyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyInput) => apiRequest<{ profile: MyProfile }>('POST', '/api/profiles/apply', { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
