// Mirrors server/src/advisor (service.ts and sanitize.ts).
import type { Me } from './auth';
import { apiGet, apiRequest } from './client';

export type AdvisorAction =
  | { type: 'quick_replies'; options: string[] }
  | { type: 'link'; label: string; url: string }
  | { type: 'video'; title: string; url: string }
  /** The hub offered the membership: the app points to its own membership screen. */
  | { type: 'membership' }
  | { type: 'card'; title: string; price: string | null; note: string | null; bullets: string[]; url: string | null };

export type AdvisorRole = 'user' | 'assistant' | 'staff' | 'system';

export type AdvisorMessage = {
  id: number;
  role: AdvisorRole;
  text: string;
  at: string;
  by: string | null;
  image: string | null;
  audio: string | null;
  actions: AdvisorAction[];
};

export type AdvisorGateType = 'membership' | 'daily' | 'rate' | 'site_cap' | 'contact' | 'other';
export type AdvisorGate = { type: AdvisorGateType; text: string; membership: boolean; expired: boolean };
export type AdvisorProfile = { botName: string; welcome: string; suggestions: string[] };
export type AdvisorContext = { type: 'project'; id: number };

export type HistoryResult = { messages: AdvisorMessage[]; profile: AdvisorProfile; me: Me | null };
export type SendResult = { messageId: number | null; waiting: boolean; human: boolean; gate: AdvisorGate | null; me: Me | null };
export type PollResult = { messages: AdvisorMessage[]; waiting: boolean; timeout: boolean; human: boolean; me: Me | null };

export const advisorApi = {
  history: () => apiGet<HistoryResult>('/api/advisor/history'),
  send: (text: string, context: AdvisorContext | null) =>
    apiRequest<SendResult>('POST', '/api/advisor/message', { body: { text, context } }),
  poll: (after: number) => apiGet<PollResult>('/api/advisor/poll', { after }),
};
