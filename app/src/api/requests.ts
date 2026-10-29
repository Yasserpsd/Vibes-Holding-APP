import { useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

// Mirrors server/src/requests/model.ts (M138 «متابعة طلباتي»): one shape for every operation the member started.
export type RequestKind = 'card' | 'hq' | 'service' | 'workshop' | 'form' | 'golden' | 'agenda' | 'persona' | 'profile' | 'deletion' | 'payment';
export type RequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected' | 'cancelled';

export type MemberRequest = {
  kind: RequestKind;
  id: string;
  title: string;
  titleEn: string;
  status: RequestStatus;
  /** The short number the member quotes (the invoice number for a payment). */
  number: string;
  createdAt: string;
  updatedAt: string | null;
  rows: { label: string; labelEn: string; value: string }[];
  /** The administration's note on a decision. */
  note: string | null;
  /** The in-app route that shows this request; null = nothing beyond the timeline. */
  screen: string | null;
  amountSar: number | null;
  invoiceNo: number | null;
  /** The card delivery: «بدون رسوم». */
  noFee: boolean;
};

export const requestsApi = {
  mine: () => apiGet<{ requests: MemberRequest[] }>('/api/me/requests'),
};

export function useMyRequests(enabled: boolean) {
  return useQuery({ queryKey: ['requests', 'mine'], queryFn: requestsApi.mine, enabled, staleTime: 15_000 });
}
