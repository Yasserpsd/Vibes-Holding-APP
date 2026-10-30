import { useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/card/routes.ts (M30): the membership card's print-and-deliver requests.
export type CardRequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected';
/** M162: the printed card is picked up at the HQ (no fees) or delivered to the member's address (shipping fees by region). */
export type CardDeliveryMethod = 'pickup' | 'delivery';

export type CardPrintRequest = {
  id: string;
  status: CardRequestStatus;
  city: string;
  address: string;
  createdAt: string;
  doneAt: string | null;
  /** An older server sends none: it only knew delivery. */
  method?: CardDeliveryMethod;
  /** M163: a new copy after a delivered card; and the moment the member himself marked it received. */
  replacement?: boolean;
  memberConfirmedAt?: string | null;
};

export type CardRequestInput = { method: CardDeliveryMethod; city?: string; address?: string; phone?: string; note?: string };

export const cardApi = {
  requestPrint: (input: CardRequestInput) => apiRequest<{ request: CardPrintRequest }>('POST', '/api/card/print', { body: input }),
  /** M163: the member says he holds the card now (picked up at the HQ or delivered); the request closes as done. */
  confirmReceived: (id: string) => apiRequest<{ request: CardPrintRequest }>('POST', `/api/card/print/${encodeURIComponent(id)}/received`),
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
