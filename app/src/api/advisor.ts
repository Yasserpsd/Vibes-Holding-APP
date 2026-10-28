// Mirrors server/src/advisor (service.ts and sanitize.ts).
import type { Me } from './auth';
import { ApiError, apiGet, apiRequest } from './client';

export type AdvisorAction =
  | { type: 'quick_replies'; options: string[] }
  | { type: 'link'; label: string; url: string }
  | { type: 'video'; title: string; url: string }
  /** The hub offered the membership: the app points to its own membership screen. */
  | { type: 'membership' }
  | { type: 'card'; title: string; price: string | null; note: string | null; bullets: string[]; url: string | null }
  // M145: app actions the server detects in the member's own line (never from the hub).
  | { type: 'hq_book'; proposal: HqProposal; missing: ('date' | 'time' | 'purpose')[]; options: HqProposalOptions; summary: string[] }
  | { type: 'screen'; screen: AppScreen; label: string }
  | { type: 'service'; key: string; title: string; answers: Record<string, string>; label: string };

/** M145 (mirrors server/src/advisor/intents.ts). */
export type AppScreen =
  | 'home'
  | 'projects'
  | 'golden'
  | 'membership'
  | 'services'
  | 'hq'
  | 'news'
  | 'videos'
  | 'posts'
  | 'account'
  | 'card'
  | 'invite'
  | 'agenda'
  | 'people'
  | 'people_apply'
  | 'guide'
  | 'workshops'
  | 'meetups'
  | 'payments'
  | 'profile'
  | 'security'
  | 'about';
export type HqKind = 'visit' | 'office' | 'meeting';
export type HqProposal = { kind: HqKind; hours: number; date: string | null; time: string | null; purpose: string | null; note: string };
export type HqProposalOptions = { kinds: { key: HqKind; label: string }[]; days: { date: string; label: string }[]; times: string[]; purposes: string[]; hours: number[] };
export type IntentResult = { action: Extract<AdvisorAction, { type: 'hq_book' | 'screen' | 'service' }> | null; reply: string | null };

export type AdvisorRole = 'user' | 'assistant' | 'staff' | 'system';

export type AdvisorMessage = {
  id: number;
  role: AdvisorRole;
  text: string;
  at: string;
  by: string | null;
  image: string | null;
  audio: string | null;
  /** M151: a PDF the member sent (stored on vcmem under a random name). */
  file: AdvisorFile | null;
  actions: AdvisorAction[];
};

export type AdvisorFile = { url: string; name: string; size: number };

export type AdvisorGateType = 'membership' | 'daily' | 'rate' | 'site_cap' | 'contact' | 'other';
export type AdvisorGate = { type: AdvisorGateType; text: string; membership: boolean; expired: boolean };
export type AdvisorProfile = { botName: string; welcome: string; suggestions: string[] };
export type PortalKey = 'neutral' | 'entrepreneur' | 'investor';
/** Screens the server knows by name (`{type:'screen'}`, docs/BRIDGE_V2.md 5.2). */
export type ScreenKey = 'home' | 'projects' | 'golden' | 'membership' | 'services' | 'partners' | 'hq' | 'news' | 'videos' | 'posts' | 'advisor' | 'account' | 'about';
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
/** M142: how the app describes a form to the server (mirrors server/src/advisor/fill.ts). */
export type FillFieldType = 'text' | 'textarea' | 'phone' | 'email' | 'number' | 'date' | 'time' | 'select' | 'multiselect';
export type FillField = { key: string; label: string; type: FillFieldType; options?: string[]; required?: boolean; hint?: string };
export type FillFormInput = { transcript: string; fields: FillField[]; known?: Record<string, string>; country?: string };
export type FillFormResult = { values: Record<string, string>; missing: string[]; followUp: string | null };
export type PollResult = { messages: AdvisorMessage[]; waiting: boolean; timeout: boolean; human: boolean; me: Me | null };

const postMessage = (text: string, context: AdvisorContext | null) =>
  apiRequest<SendResult>('POST', '/api/advisor/message', { body: { text, context } });
// M151: a PDF (base64, up to 10 MB) with an optional line; the server checks it and hands it to the hub.
const postFile = (file: string, name: string, text: string, context: AdvisorContext | null) =>
  apiRequest<SendResult>('POST', '/api/advisor/file', { body: { file, name, text, context }, timeoutMs: 90_000 });

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
  /** M151: same refusal rule as `send` for an older server that knows fewer context types. */
  sendFile: async (file: string, name: string, text: string, context: AdvisorContext | null): Promise<SentMessage> => {
    try {
      return { ...(await postFile(file, name, text, context)), contextRefused: false };
    } catch (error) {
      if (!context || !(error instanceof ApiError) || error.status !== 400 || error.code !== 'invalid') throw error;
      return { ...(await postFile(file, name, text, null)), contextRefused: true };
    }
  },
  poll: (after: number) => apiGet<PollResult>('/api/advisor/poll', { after }),
  // M104: the recorded question (base64) comes back as text; the app then sends it as a message.
  transcribe: (audio: string, mime: string) => apiRequest<{ text: string }>('POST', '/api/advisor/transcribe', { body: { audio, mime } }),
  // M145: is this line an app action? An older server answers 404 → treated as «no».
  intent: async (text: string, pending: HqProposal | null): Promise<IntentResult> => {
    try {
      return await apiRequest<IntentResult>('POST', '/api/advisor/intent', { body: { text, pending } });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 429)) return { action: null, reply: null };
      throw error;
    }
  },
  // M142: one spoken message → the form's values; the server normalises phones, e-mails, dates and choices.
  fillForm: (input: FillFormInput) => apiRequest<FillFormResult>('POST', '/api/advisor/fill-form', { body: input }),
};
