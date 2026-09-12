import { useQuery } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/payments/service.ts (PublicPayment).
export type PaymentStatus = 'created' | 'paid' | 'failed';

export type Payment = {
  id: string;
  serviceKey: string;
  serviceTitle: string;
  answers: { key: string; label: string; value: string }[];
  amount: number;
  currency: string;
  memberPrice: boolean;
  status: PaymentStatus;
  provider: 'paymob' | 'mock';
  checkoutUrl: string;
  transactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
};

export const paymentsApi = {
  start: (serviceKey: string, answers: Record<string, string>) => apiRequest<{ payment: Payment }>('POST', '/api/payments', { body: { serviceKey, answers } }),
  get: (id: string) => apiGet<{ payment: Payment }>(`/api/payments/${encodeURIComponent(id)}`),
  list: () => apiGet<{ payments: Payment[] }>('/api/payments'),
};

/** One payment; polls every few seconds while the gateway's callback is still awaited. */
export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: ['payments', 'one', id],
    queryFn: () => paymentsApi.get(id ?? ''),
    enabled: Boolean(id),
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.payment.status === 'created' ? 3_000 : false),
  });
}

export function useMyPayments(enabled: boolean) {
  return useQuery({ queryKey: ['payments', 'mine'], queryFn: paymentsApi.list, enabled, staleTime: 15_000 });
}

export function amountLabel(payment: Pick<Payment, 'amount' | 'currency'>): string {
  return `${new Intl.NumberFormat('en-US').format(payment.amount)} ${payment.currency === 'SAR' ? 'ريال' : payment.currency}`;
}
