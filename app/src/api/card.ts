import { useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/card/routes.ts (M30): the membership card's print-and-deliver requests.
export type CardRequestStatus = 'pending' | 'done';

export type CardPrintRequest = {
  id: string;
  status: CardRequestStatus;
  city: string;
  address: string;
  createdAt: string;
  doneAt: string | null;
};

export type CardRequestInput = { city: string; address: string; phone?: string; note?: string };

export const cardApi = {
  requestPrint: (input: CardRequestInput) => apiRequest<{ request: CardPrintRequest }>('POST', '/api/card/print', { body: input }),
};

/** The member's own print request, so the screen shows «قيد التنفيذ» instead of a second button. */
export function usePrintRequest(enabled: boolean) {
  return useQuery({
    queryKey: ['card', 'print'],
    queryFn: () => apiGet<{ request: CardPrintRequest | null }>('/api/card/print'),
    enabled,
    staleTime: 60_000,
  });
}
