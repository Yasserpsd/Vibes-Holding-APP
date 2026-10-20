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
  /** M70: every day the event runs (a multi-day workshop); an older server sends none. */
  dates?: string[];
  time: string;
  endTime: string;
  place: string;
  mode: AgendaMode;
  feeSar: number;
  /** M107: the member price (0 = ضمن العضوية), what THIS viewer pays, and the membership saving. */
  memberFeeSar?: number;
  myFeeSar?: number;
  savingsSar?: number;
  /** M107: the unified interest keys this event suits. */
  interests?: string[];
  open: boolean;
  /** My registration, when I am signed in and registered. */
  mine: { attendance: AgendaAttendance; paid: boolean } | null;
  /** True when THIS viewer pays a fee. */
  mustPay: boolean;
  /** Only for a confirmed online attendee. */
  onlineUrl: string | null;
  /** M77: the big hero image above the details; an older server sends none. */
  imageUrl?: string | null;
  /** M77: the event's last day has passed — listed faded; an older server sends none. */
  past?: boolean;
};

export type AgendaRegisterAnswer = {
  registration: { id: string; attendance: AgendaAttendance; paid: boolean };
  payment: Payment | null;
};

/** M107: what a code does to this viewer's fee, and the confirmed attendee's QR ticket. */
export type AgendaDiscount = { code: string; percent: number; amountBefore: number; amountAfter: number };
export type AgendaTicket = {
  event: { id: string; title: string; date: string; dates: string[]; time: string; endTime: string; place: string };
  name: string;
  attendance: AgendaAttendance;
  attendanceLabel: string;
  code: string;
  qr: string;
  state: 'upcoming' | 'active' | 'expired';
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
    mutationFn: (input: { eventId: string; attendance: AgendaAttendance; discountCode?: string }) =>
      apiRequest<AgendaRegisterAnswer>('POST', `/api/agenda/${encodeURIComponent(input.eventId)}/register`, {
        body: { attendance: input.attendance, ...(input.discountCode ? { discountCode: input.discountCode } : {}) },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agenda'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

/** M107 «تحقق من الكود»: previews a discount code against this event's fee for me. */
export function useAgendaDiscount() {
  return useMutation({
    mutationFn: (input: { eventId: string; code: string }) =>
      apiRequest<AgendaDiscount>('POST', `/api/agenda/${encodeURIComponent(input.eventId)}/discount`, { body: { code: input.code } }),
  });
}

/** M107: the confirmed attendee's ticket (QR). */
export function useAgendaTicket(eventId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agenda', 'ticket', eventId],
    queryFn: () => apiGet<{ ticket: AgendaTicket }>(`/api/agenda/${encodeURIComponent(eventId ?? '')}/ticket`),
    enabled: Boolean(eventId) && enabled,
    staleTime: 60_000,
  });
}
