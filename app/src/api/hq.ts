import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/hq/service.ts and server/src/content/hq.ts.
export type HqContent = {
  title: string;
  intro: string;
  address: string;
  mapUrl: string;
  tourVideoId: string;
  facilities: string[];
  rules: string[];
  memberOnlyText: string;
  guestText: string;
  hours: { days: number[]; open: string; close: string; slotMinutes: number };
  leadDays: number;
  maxDaysAhead: number;
  purposes: string[];
  updatedAt: string;
};

export type HqAccess = 'guest' | 'locked' | 'expired' | 'member';

export type HqOverview = {
  content: HqContent;
  access: HqAccess;
  lockedText: string | null;
  days: { date: string; weekday: number }[];
  times: string[];
};

export type VisitStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export type Visit = {
  id: string;
  date: string;
  time: string;
  endTime: string;
  purpose: string;
  note: string;
  status: VisitStatus;
  createdAt: string;
  decidedAt: string | null;
  adminNote: string | null;
  hasPass: boolean;
  slotStart: string;
  slotEnd: string;
  cancellable: boolean;
};

export type AdminVisit = Visit & { contactId: number; name: string; phone: string; email: string };

export type PassState = 'upcoming' | 'active' | 'expired';

export type Pass = { visit: Visit; code: string; qr: string; validFrom: string; validTo: string; state: PassState };

export type Slot = { time: string; endTime: string; available: boolean };

export type VerifyResult = { valid: boolean; state: PassState | 'unknown'; visit: AdminVisit | null; text: string };

export const hqApi = {
  overview: () => apiGet<HqOverview>('/api/hq'),
  slots: (date: string) => apiGet<{ date: string; slots: Slot[] }>('/api/hq/slots', { date }),
  myVisits: () => apiGet<{ visits: Visit[] }>('/api/hq/visits'),
  book: (input: { date: string; time: string; purpose: string; note: string }) => apiRequest<{ visit: Visit }>('POST', '/api/hq/visits', { body: input }),
  cancel: (id: string) => apiRequest<{ visit: Visit }>('POST', `/api/hq/visits/${encodeURIComponent(id)}/cancel`, { body: {} }),
  pass: (id: string) => apiGet<{ pass: Pass }>(`/api/hq/visits/${encodeURIComponent(id)}/pass`),
  adminVisits: (status?: VisitStatus) => apiGet<{ visits: AdminVisit[] }>('/api/admin/hq/visits', { status }),
  decide: (id: string, status: 'confirmed' | 'rejected', note: string) =>
    apiRequest<{ visit: AdminVisit }>('POST', `/api/admin/hq/visits/${encodeURIComponent(id)}/decision`, { body: { status, note } }),
  verify: (code: string) => apiRequest<VerifyResult>('POST', '/api/admin/hq/verify', { body: { code } }),
};

function useAccountKey(): string {
  const { status, me } = useAuth();
  return status === 'signedIn' && me ? `${me.id}:${me.membership.status}` : 'guest';
}

export function useHq() {
  const account = useAccountKey();
  return useQuery({ queryKey: ['hq', 'overview', account], queryFn: hqApi.overview, staleTime: 5 * 60_000 });
}

export function useMyVisits(enabled: boolean) {
  const account = useAccountKey();
  return useQuery({ queryKey: ['hq', 'visits', account], queryFn: hqApi.myVisits, enabled, staleTime: 30_000 });
}

export function useHqSlots(date: string | null) {
  return useQuery({ queryKey: ['hq', 'slots', date], queryFn: () => hqApi.slots(date ?? ''), enabled: Boolean(date), staleTime: 15_000 });
}

export function usePass(id: string | undefined) {
  return useQuery({ queryKey: ['hq', 'pass', id], queryFn: () => hqApi.pass(id ?? ''), enabled: Boolean(id), staleTime: 60_000 });
}

export function useAdminVisits(status: VisitStatus | undefined, enabled: boolean) {
  return useQuery({ queryKey: ['hq', 'admin', status ?? 'all'], queryFn: () => hqApi.adminVisits(status), enabled, staleTime: 15_000 });
}
