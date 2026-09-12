/**
 * Shapes returned by the vcmem.com hub (Vibes AI Assistant plugin, site-facing API
 * `POST /wp-json/vibes-ai/v1/hub/{op}` with header X-VAI-Site-Key). See docs/HUB_BRIDGE.md.
 */

/** `public_contact()` in the plugin: the account as the hub exposes it to tenant sites. */
export type HubContact = {
  id: number;
  name: string;
  email: string;
  phone: string;
  stage: number;
  is_member: 0 | 1;
  member_left: number | null;
  member_days: number;
  member_end: string;
  member_expired: 0 | 1;
  daily_limit: number;
  daily_left: number | null;
  has_account: 0 | 1;
  verified: 0 | 1;
  role: string;
  is_admin: 0 | 1;
  job_title: string;
  persona: string;
  website: string;
  social: string;
  avatar: string;
  company: string;
  city: string;
  bio: string;
  pending_pay: 0 | 1;
};

/** One row of the hub's `messages` table as `poll` / `history` return it (`history_rows()` / `op_poll()`). */
export type HubMessage = {
  id: number;
  /** user = the member, assistant = the AI, human = a staff reply from the hub console, system = hub notice. */
  role: string;
  content: string;
  /** Reply widgets chosen by the workflow (`expand_actions()`): quick_replies, link, open_page, card, video, prefill_form… */
  actions: unknown[];
  image?: string;
  audio?: string;
  by?: string;
  at: string;
};

/** `gate_payload()`: why the hub refused to answer (membership, daily limit, rate, site cap, contact). */
export type HubGate = {
  type: string;
  text?: string;
  card?: unknown;
  mgmt?: string;
  needs_account?: 0 | 1;
  saudi?: 0 | 1;
  days?: number;
};

export type HubOp =
  | 'ping'
  | 'config'
  | 'register'
  | 'resend_code'
  | 'verify'
  | 'login'
  | 'logout'
  | 'account'
  | 'profile'
  | 'reset_request'
  | 'reset_confirm'
  | 'delete_account'
  | 'activate_member'
  | 'message'
  | 'poll'
  | 'history';

export type HubBody = Record<string, unknown>;

/** Successful hub answers always carry ok:true; the other fields depend on the op. */
export type HubResponse = {
  ok: true;
  pending?: boolean;
  already?: boolean;
  mail_sent?: 0 | 1;
  sent?: boolean;
  text?: string;
  contact?: HubContact | null;
  /** `config`: `widget_config()` — bot name, welcome text, menu, membership card, link library… */
  config?: Record<string, unknown>;
  /** `message` */
  message_id?: number;
  waiting?: boolean;
  gated?: boolean;
  gate?: HubGate;
  human?: boolean;
  image_url?: string;
  audio_url?: string;
  transcript?: string;
  /** `poll` / `history` */
  messages?: HubMessage[];
  timeout?: boolean;
  cfg_rev?: number;
};

/** A hub error keeps the plugin's code and Arabic message so the app can show them as they are. */
export class HubError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HubError';
  }
}

export interface HubClient {
  readonly mode: 'live' | 'mock';
  call(op: HubOp, body: HubBody): Promise<HubResponse>;
}
