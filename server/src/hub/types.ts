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

export type HubOp =
  | 'ping'
  | 'register'
  | 'resend_code'
  | 'verify'
  | 'login'
  | 'logout'
  | 'account'
  | 'profile'
  | 'reset_request'
  | 'reset_confirm'
  | 'delete_account';

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
