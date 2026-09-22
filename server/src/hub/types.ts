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
  | 'history'
  // Bridge v2 (plugin 2.7.0, docs/BRIDGE_V2.md 1.3): privileged ops, only for the hub's trusted site.
  | 'admin_stats'
  | 'admin_accounts'
  | 'admin_member'
  | 'admin_payments'
  | 'admin_tickets'
  | 'admin_leads'
  | 'admin_threads'
  | 'admin_thread'
  | 'admin_reply'
  | 'admin_mail'
  | 'admin_grant'
  | 'admin_set_role'
  | 'changes'
  | 'publish'
  | 'feed';

export type HubBody = Record<string, unknown>;

/** Successful hub answers always carry ok:true; the other fields depend on the op. */
export type HubResponse = {
  ok: true;
  pending?: boolean;
  already?: boolean;
  mail_sent?: 0 | 1;
  /** `register` since plugin 2.7.2: the invite code's owner as the hub resolved and stored him (M32); 0 = no referral. */
  referred_by?: number;
  referred_name?: string;
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

/** Bridge v2 shapes (docs/BRIDGE_V2.md 1.3 and 1.4). Times are UTC `Y-m-d H:i:s`; day fields are Riyadh days. */
export type HubAccountState = 'pending' | 'unpaid' | 'member' | 'expired' | 'lead';

export type HubAccount = {
  id: number;
  name: string;
  email: string;
  phone: string;
  state: HubAccountState;
  role: string;
  persona: string;
  job_title: string;
  company: string;
  city: string;
  created_at: string;
  verified_at: string | null;
  last_at: string | null;
  last_login_at: string | null;
  site: string;
  msg_count: number;
  is_member: 0 | 1;
  member_left: number | null;
  member_days: number;
  member_end: string;
  never_expires: 0 | 1;
  daily_limit: number;
  daily_left: number | null;
  intent: number;
  intent_label: string;
  has_password: 0 | 1;
  /** Plugin 2.7.2 (M32): the contact whose invite code this account registered with; 0 or absent = none. */
  referred_by?: number;
};

export type HubPayment = {
  id: number;
  txn_id: string;
  order_id: string;
  amount_cents: number;
  currency: string;
  success: 0 | 1;
  action: string;
  name: string;
  phone: string;
  email: string;
  contact_id: number;
  note: string;
  created_at: string;
};

export type HubTicket = {
  id: number;
  ref: string;
  contact_id: number;
  name: string;
  phone: string;
  email: string;
  event_title: string;
  event_date: string;
  event_place: string;
  source: string;
  checked_in: 0 | 1;
  created_at: string;
};

export type HubLead = {
  id: number;
  contact_id: number;
  name: string;
  phone: string;
  site: string;
  ltype: string;
  reason: string;
  company: string;
  notes: string;
  status: string;
  intent: number;
  intent_label: string;
  created_at: string;
};

export type HubEventKind = 'registered' | 'verified' | 'activated' | 'renewed' | 'revoked' | 'role' | 'deleted';

export type HubEvent = {
  id: number;
  contact_id: number;
  kind: HubEventKind;
  days: number;
  source: string;
  ref: string;
  actor_id: number;
  actor_name: string;
  note: string;
  created_at: string;
};

export type HubThread = {
  contact_id: number;
  name: string;
  phone: string;
  site: string;
  last_text: string;
  last_role: string;
  last_at: string;
  unread: number;
  waiting: 0 | 1;
  human: 0 | 1;
  is_member: 0 | 1;
  intent: number;
  intent_label: string;
};

export type HubThreadMessage = { id: number; role: string; content: string; by: string; page_url: string; at: string };

export type HubMailStats = { pending: number; sent: number; failed: number };
export type HubMailItem = { id: number; to_email: string; subject: string; kind: string; status: string; attempts: number; created_at: string; sent_at: string | null };

export type HubStatsDay = {
  day: string;
  signups: number;
  verified: number;
  activations: number;
  renewals: number;
  payments_count: number;
  payments_cents: number;
  conversations: number;
  messages: number;
  leads: number;
};

export type HubStats = {
  ok: true;
  generated_at: string;
  tz: 'Asia/Riyadh';
  days: number;
  totals: { contacts: number; leads: number; accounts: number; pending_email: number; unpaid: number; members_active: number; members_expired: number; members_no_expiry: number; admins: number; publishers: number };
  today: Omit<HubStatsDay, 'day'>;
  expiring: { d7: number; d30: number; items: { id: number; name: string; phone: string; email: string; member_end: string; days_left: number }[] };
  series: HubStatsDay[];
  per_site: { host: string; name: string; conversations: number; messages: number }[];
  mail: HubMailStats;
  ai: { replies_today: number; members_today: number };
};

export type HubChange = { id: number; host: string; site: string; url: string; title: string; kind: string; excerpt: string; updated_at: string };
export type HubFeedEvent = { date: string; place: string; online_url: string };
export type HubFeedItem = { key: string; kind: 'post' | 'event'; title: string; excerpt: string; url: string; image: string; event: HubFeedEvent | null; at: string };

type Listed<T> = { ok: true; total: number; page: number; per_page: number; items: T[] };

/** What every bridge v2 op answers, by op. `hubCall()` types the generic `call()` with it. */
export type HubResults = {
  ping: { ok: true; hub?: string; site?: string; time?: string; version?: string };
  admin_stats: HubStats;
  admin_accounts: Listed<HubAccount> & { counts: Record<string, number> };
  admin_member: { ok: true; account: HubAccount; memo: string; notes: string; sites: string[]; payments: HubPayment[]; tickets: HubTicket[]; leads: HubLead[]; events: HubEvent[] };
  admin_payments: Listed<HubPayment> & { sum_cents_ok: number };
  admin_tickets: Listed<HubTicket>;
  admin_leads: Listed<HubLead>;
  admin_threads: Listed<HubThread>;
  admin_thread: { ok: true; account: HubAccount; messages: HubThreadMessage[]; has_more: boolean };
  admin_reply: { ok: true; message_id: number };
  admin_mail: { ok: true; stats: HubMailStats; items: HubMailItem[] };
  admin_grant: { ok: true; contact: HubContact; event: HubEvent };
  admin_set_role: { ok: true; contact: HubContact };
  activate_member: { ok: true; contact: HubContact; already: boolean };
  changes: { ok: true; cursor: number; items: HubChange[] };
  publish: { ok: true; id: number };
  feed: { ok: true; items: HubFeedItem[] };
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

/** `call()` with the answer typed by op (bridge v2 ops answer fields the generic `HubResponse` does not list). */
export async function hubCall<K extends keyof HubResults>(hub: HubClient, op: K, body: HubBody): Promise<HubResults[K]> {
  return (await hub.call(op, body)) as unknown as HubResults[K];
}
