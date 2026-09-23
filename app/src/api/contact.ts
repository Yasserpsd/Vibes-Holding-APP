import { useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/contact/routes.ts (M36): «راسل الإدارة» — one thread per member.
export type ContactMessage = {
  id: string;
  from: 'member' | 'admin';
  /** The admin's name on a reply; null when the member himself wrote. */
  by: string | null;
  text: string;
  at: string;
};

export const contactApi = {
  send: (text: string) => apiRequest<{ message: ContactMessage }>('POST', '/api/contact', { body: { text } }),
};

/** The member's thread; polled while the screen is open so the management's reply lands by itself. */
export function useContactThread(enabled: boolean) {
  return useQuery({
    queryKey: ['contact', 'thread'],
    queryFn: () => apiGet<{ messages: ContactMessage[] }>('/api/contact'),
    enabled,
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
}
