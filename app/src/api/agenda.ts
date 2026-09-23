import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiRequest } from './client';
import type { Payment } from './payments';

// M41 «أجندة النادي» — mirrors server/src/agenda/routes.ts.
export type AgendaMode = 'hq' | 'online' | 'both';
export type AgendaAttendance = 'hq' | 'online';

export type AgendaEvent = {
  id: string;
  title: string;
  blurb: string;
  date: string;
  time: string;
  endTime: string;
  place: string;
  mode: AgendaMode;
  feeSar: number;
  open: boolean;
  /** My registration, when I am signed in and registered. */
  mine: { attendance: AgendaAttendance; paid: boolean } | null;
  /** True when THIS viewer pays the fee (signed in, no active membership, fee > 0). */
  mustPay: boolean;
  /** Only for a confirmed online attendee. */
  onlineUrl: string | null;
};

export type AgendaRegisterAnswer = {
  registration: { id: string; attendance: AgendaAttendance; paid: boolean };
  payment: Payment | null;
};

export function useAgenda() {
  return useQuery({
    queryKey: ['agenda'],
    queryFn: () => apiGet<{ events: AgendaEvent[] }>('/api/agenda'),
    staleTime: 30_000,
  });
}

export function useAgendaEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['agenda', 'event', id],
    queryFn: () => apiGet<{ event: AgendaEvent }>(`/api/agenda/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useRegisterAgenda() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; attendance: AgendaAttendance }) =>
      apiRequest<AgendaRegisterAnswer>('POST', `/api/agenda/${encodeURIComponent(input.eventId)}/register`, { body: { attendance: input.attendance } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
