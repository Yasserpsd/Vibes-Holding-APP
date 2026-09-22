// Mirrors server/src/advisor (service.ts and sanitize.ts).
import type { Me } from './auth';
import { ApiError, apiGet, apiRequest } from './client';

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
export type PortalKey = 'neutral' | 'entrepreneur' | 'investor';
/** Screens the server knows by name (`{type:'screen'}`, docs/BRIDGE_V2.md 5.2). */
export type ScreenKey = 'home' | 'projects' | 'golden' | 'membership' | 'services' | 'hq' | 'news' | 'videos' | 'posts' | 'advisor' | 'account' | 'about';
/** What the member looks at. The app sends only type and id: the server builds the text from its own public data. */
export type AdvisorContext =
  | { type: 'project'; id: number }
  | { type: 'news'; id: string }
  | { type: 'portal'; id: PortalKey }
  | { type: 'service'; id: string }
  | { type: 'post'; id: string }
  | { type: 'video'; id: string }
  | { type: 'screen'; id: ScreenKey };

export type HistoryResult = { messages: AdvisorMessage[]; profile: AdvisorProfile; me: Me | null };
export type SendResult = { messageId: number | null; waiting: boolean; human: boolean; gate: AdvisorGate | null; me: Me | null };
/** `contextRefused`: the server took the message only without its context. */
export type SentMessage = SendResult & { contextRefused: boolean };
export type PollResult = { messages: AdvisorMessage[]; waiting: boolean; timeout: boolean; human: boolean; me: Me | null };

const postMessage = (text: string, context: AdvisorContext | null) =>
  apiRequest<SendResult>('POST', '/api/advisor/message', { body: { text, context } });

export const advisorApi = {
  history: () => apiGet<HistoryResult>('/api/advisor/history'),
  /**
   * The context helps the advisor; it is never a condition for sending. A server older than bridge v2 knows fewer
   * context types and refuses the whole message (400 `invalid`, decided before anything reaches the hub, so nothing
   * was stored and nothing is sent twice): the message then goes again without its context.
   */
  send: async (text: string, context: AdvisorContext | null): Promise<SentMessage> => {
    try {
      return { ...(await postMessage(text, context)), contextRefused: false };
    } catch (error) {
      if (!context || !(error instanceof ApiError) || error.status !== 400 || error.code !== 'invalid') throw error;
      return { ...(await postMessage(text, null)), contextRefused: true };
    }
  },
  poll: (after: number) => apiGet<PollResult>('/api/advisor/poll', { after }),
};
