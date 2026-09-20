/**
 * Bridge v2 shapes as the server answers them (docs/BRIDGE_V2.md 1.3, 1.4 and 5.1). Hub data keeps the hub's
 * snake_case names; the server's own data is camelCase. Hub times are UTC `Y-m-d H:i:s`, day fields are Riyadh days.
 */
export type SectionError = { code: string; message: string };
export type Listed<T> = { ok: true; total: number; page: number; per_page: number; items: T[] };

export type AccountState = 'pending' | 'unpaid' | 'member' | 'expired' | 'lead';
/** The filters of the members list: the states plus the two roles and «all» (which leaves the leads out). */
export type AccountFilter = 'all' | 'pending' | 'unpaid' | 'member' | 'expired' | 'admin' | 'publisher' | 'lead';

export type Account = {
  id: number;
  name: string;
  email: string;
  phone: string;
  state: AccountState;
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
};

/** Projects Bank «رصيد» counted in projects, not riyals. */
export type PbBeside = { left: number; used: number; granted: number };
export type PbBalance = PbBeside & { credits: number; period_start: string; unlocked: number[] };

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

export type Ticket = {
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

export type Lead = {
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

export type MemberEvent = {
  id: number;
  contact_id: number;
  kind: string;
  days: number;
  source: string;
  ref: string;
  actor_id: number;
  actor_name: string;
  note: string;
  created_at: string;
};

export type Thread = {
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
export type ThreadFilter = 'all' | 'waiting' | 'human' | 'unread';
export type ThreadMessage = { id: number; role: string; content: string; by: string; page_url: string; at: string };

export type MailStats = { pending: number; sent: number; failed: number };
export type MailItem = { id: number; to_email: string; subject: string; kind: string; status: string; attempts: number; created_at: string; sent_at: string | null };

export type StatsDay = {
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
  tz: string;
  days: number;
  totals: { contacts: number; leads: number; accounts: number; pending_email: number; unpaid: number; members_active: number; members_expired: number; members_no_expiry: number; admins: number; publishers: number };
  today: Omit<StatsDay, 'day'>;
  expiring: { d7: number; d30: number; items: { id: number; name: string; phone: string; email: string; member_end: string; days_left: number }[] };
  series: StatsDay[];
  per_site: { host: string; name: string; conversations: number; messages: number }[];
  mail: MailStats;
  ai: { replies_today: number; members_today: number };
};

/** `count` = payments created that Riyadh day, `paid` and `cents` = paid that day. */
export type PaymentTotals = { count: number; cents: number; paid: number };
export type BridgeSide = { version: string | null; ok: boolean };

/** Never fails as a whole: a part that could not load is null with its entry in `errors`. */
export type Home = {
  hub: HubStats | null;
  app: {
    payments: { series: ({ day: string } & PaymentTotals)[]; today: PaymentTotals; month: PaymentTotals };
    store: { series: { day: string; purchases: number; renewals: number }[] };
    push: { devices: number };
  };
  pb: { unlocksToday: number | null };
  bridge: { hub: BridgeSide; pb: BridgeSide };
  errors: { hub?: SectionError; pb?: SectionError };
};

export type AccountRow = Account & { pb: PbBeside | null };
export type AccountsResult = Listed<AccountRow> & { counts: Record<string, number>; pbError: SectionError | null };
export type MemberDetail = {
  ok: true;
  account: Account;
  memo: string;
  notes: string;
  sites: string[];
  payments: HubPayment[];
  tickets: Ticket[];
  leads: Lead[];
  events: MemberEvent[];
  pb: PbBalance | null;
  pbError: SectionError | null;
};
export type ThreadDetail = { ok: true; account: Account; messages: ThreadMessage[]; has_more: boolean };

/** A service paid inside the app through Paymob (the server's own record, camelCase). */
export type AppPayment = {
  id: string;
  serviceKey: string;
  serviceTitle: string;
  amount: number;
  currency: string;
  memberPrice: boolean;
  status: 'created' | 'paid' | 'failed';
  provider: 'paymob' | 'mock';
  transactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  failedAt: string | null;
  contactId: number;
  name: string;
  email: string;
  phone: string;
  orderId: string;
};

/** A store (Apple / Google) membership event as RevenueCat reported it. It carries no amount. */
export type StorePurchase = {
  id: string;
  type: string;
  contactId: number | null;
  productId: string;
  store: string;
  environment: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  transactionId: string | null;
  days: number;
  receivedAt: string;
  activation: 'activated' | 'pending' | 'ignored' | 'skipped' | 'duplicate';
  reason: string | null;
};

export type AuditAction = 'grant' | 'role' | 'pb_grant' | 'reply';
export type AuditEntry = {
  id: string;
  at: string;
  actor: { id: number; name: string; email: string };
  action: AuditAction;
  contactId: number;
  params: Record<string, unknown>;
  note: string;
  result: 'ok' | 'error';
  error: string | null;
  requestId: string | null;
};

export type GrantAction = 'activate' | 'extend' | 'revoke';
/** Every write carries `confirm: true` and a per-tap `requestId`, so a double tap changes nothing twice. */
export type WriteMeta = { note: string; requestId: string };
