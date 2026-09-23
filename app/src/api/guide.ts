import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// M10 «دليل المحايد» — mirrors server/src/content/guide.ts and server/src/workshops/routes.ts.
export type GuideTarget = 'advisor' | 'workshops' | 'projects' | 'membership';
export type GuideStep = { key: string; title: string; text: string; cta: string; target: GuideTarget };
export type GuideWorkshop = { id: string; title: string; blurb: string; schedule: string; mode: 'hq' | 'online' | 'both'; open: boolean; order: number };
export type Guide = {
  title: string;
  intro: string;
  steps: GuideStep[];
  benefitsTitle: string;
  benefits: string[];
  workshops: { title: string; intro: string; note: string; registerCta: string; registeredText: string; closedText: string; items: GuideWorkshop[] };
};

export type MyWorkshopRegistration = { id: string; workshopId: string; createdAt: string };

export function useGuide() {
  return useQuery({
    queryKey: ['guide'],
    queryFn: () => apiGet<Guide>('/api/guide'),
    staleTime: 60_000,
  });
}

export function useMyWorkshops(enabled: boolean) {
  return useQuery({
    queryKey: ['workshops', 'mine'],
    queryFn: () => apiGet<{ registrations: MyWorkshopRegistration[] }>('/api/workshops/mine'),
    enabled,
  });
}

export function useRegisterWorkshop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workshopId: string; note?: string }) => apiRequest<{ registration: MyWorkshopRegistration }>('POST', '/api/workshops/register', { body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workshops', 'mine'] }),
  });
}
