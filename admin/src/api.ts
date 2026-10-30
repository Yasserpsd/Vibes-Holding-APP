import type { AccountFilter, AccountsResult, Personas, PersonaFilter, AnalyticsResult, AppPayment, AuditEntry, ContentList, ContentValues, Downloads, GrantAction, Home, HubPayment, Lead, Listed, MailItem, MailStats, MemberDetail, NewsSourceRow, NewsSourcesResult, StorePurchase, Thread, ThreadDetail, ThreadFilter, Ticket, WordingEdit, WordingLang, WordingList, WriteMeta } from './types';

// Public value: the TEST API. A production dashboard gets its URL from VITE_API_URL at build time.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://vibes-holding-app-production.up.railway.app';
const TOKEN_KEY = 'club-admin-token';

export type Me = { id: number; name: string; email: string; isAdmin: boolean; isModerator: boolean };
export type LoginResult =
  | { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string }
  | { pending: false; otp?: undefined; token: string; me: Me };
/** The password was right and the server e-mailed a short-lived code: the session starts after it (M18). */
export type OtpStep = { pending: false; otp: true; challengeToken: string; email: string; seconds: number; resendAfter: number };
/** M140: the account has an authenticator app; the session starts after its code (or a backup code). */
export type TotpStep = { pending: false; totp: true; stepToken: string; seconds: number };
/** M140: a dashboard account without an authenticator yet links one before its first session. */
export type TotpSetupStep = { pending: false; totpSetup: true; setupToken: string; secret: string; uri: string; seconds: number };
export type AdminLoginResult = LoginResult | OtpStep | TotpStep | TotpSetupStep;
export type TotpStatus = { enabled: boolean; enabledAt: string | null; backupLeft: number };
export type TotpSetup = { setupToken: string; secret: string; uri: string; seconds: number };

export type PostLink = { label: string; url: string };
/** An uploaded video: both values are `url`s the uploads endpoint returned. */
export type PostVideo = { url: string; poster: string | null };
export type Post = {
  id: string;
  title: string;
  body: string;
  links: PostLink[];
  images: string[];
  youtubeId: string | null;
  /** Posts older than uploads have no `video` key at all: read a missing key as null. */
  video?: PostVideo | null;
  status: 'draft' | 'published';
  pinned: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  notifiedAt: string | null;
  /** Posts stored before bridge v2 have neither key: they are plain posts. */
  kind?: PostKind;
  event?: PostEvent | null;
  /** M29: posts stored before it have no key and are for everyone. */
  audience?: PostAudience;
  /** M31: the poll behind a `kind: 'poll'` post, and its live counts as the admin list attaches them. */
  poll?: PostPoll | null;
  pollResults?: PollResults | null;
  /** How the last hand-over to the hub went: the websites and the assistant hear a post through it. */
  hubSync?: PostHubSync;
  /** M43: the post's English — AI once, the owner's edit wins (`enAuto: false`). */
  en?: { title: string; body: string; place: string | null } | null;
  enAuto?: boolean;
};
export type PostKind = 'post' | 'event' | 'poll';
/** `date` is a day (`2026-10-05`) or an exact time (`2026-10-05T19:30:00+03:00`). */
export type PostEvent = { date: string; place: string; onlineUrl: string | null };
/** M31: a poll's stored shape, its editor input (existing options keep their id so votes survive), and its counts. */
export type PostPoll = { options: { id: string; label: string }[]; closesAt: string | null; resultsVisible: boolean };
export type PostPollInput = { options: { id?: string; label: string }[]; closesAt: string | null; resultsVisible: boolean };
export type PollResults = { options: { id: string; label: string; votes: number | null }[]; closesAt: string | null; closed: boolean; resultsVisible: boolean; totalVotes: number | null; myVote: string | null };
/** M29: everyone, one persona, or one member («رسالة Admin»). `name` is only the shown label. */
export type PostPersona = 'neutral' | 'entrepreneur' | 'investor';
export type PostAudience = { type: 'all' } | { type: 'persona'; persona: PostPersona } | { type: 'member'; contactId: number; name: string };
export type PostHubSync = { state: 'ok' | 'failed' | 'unsupported'; at: string; error: string | null; published: boolean };
/** `video` is the YouTube link or id, `videoFile` the uploaded video; a post may carry both. */
export type PostInput = { title: string; body: string; english?: { title: string; body: string } | null; links: PostLink[]; images: string[]; video: string | null; videoFile: PostVideo | null; status: 'draft' | 'published'; pinned: boolean; kind: PostKind; event: PostEvent | null; poll: PostPollInput | null; audience: PostAudience };

/** M30: a member's request for his printed membership card, delivered to his door at no charge. */
/** M7/M109a: an HQ visit or office/meeting-room booking as the dashboard reviews it. */
export type HqVisit = {
  id: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  endTime: string;
  purpose: string;
  note: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  createdAt: string;
  decidedAt: string | null;
  adminNote: string | null;
  /** M109a: the hours-wallet booking parts; a plain visit carries none. */
  space?: 'office' | 'meeting' | null;
  hours?: number | null;
};

/** M109d: a member's «طلب تغيير الصفة» as the dashboard reviews it. */
export type PersonaChangeRequest = {
  id: string;
  contactId: number;
  name: string;
  email: string;
  from: string;
  to: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
};

export type CardRequest = {
  id: string;
  contactId: number;
  cardNumber: string;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  jobTitle: string;
  city: string;
  address: string;
  note: string;
  status: RequestStatus;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
  adminNote?: string | null;
  /** M163: a new copy after a delivered card; the member's own receipt mark from the app. */
  method?: 'pickup' | 'delivery';
  replacement?: boolean;
  memberConfirmedAt?: string | null;
};

/** M138: the status every member request moves through — mirrors server/src/requests/model.ts. */
export type RequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected' | 'cancelled';

/** M138: a service request or golden interest on the ledger (the operations that had no store before). */
export type LedgerEntry = {
  id: string;
  kind: 'service' | 'golden';
  contactId: number;
  name: string;
  phone: string;
  email: string;
  lang: 'ar' | 'en';
  title: string;
  ref: string;
  rows: { label: string; labelEn: string; value: string }[];
  status: RequestStatus;
  createdAt: string;
  updatedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
};

/** M32: one invited registration — mirrors server/src/invites/service.ts. */
export type InviteRecord = {
  id: string;
  inviteeId: number;
  inviteeName: string;
  inviteePhone: string;
  inviteeEmail: string;
  inviterId: number;
  inviterName: string;
  inviterNumber: string;
  code: string;
  createdAt: string;
  verifiedAt: string | null;
  activatedAt: string | null;
  gift: { note: string; doneAt: string; doneBy: string } | null;
};

export type InvitesConfig = { giftText: string; shareText: string };

/** M36: «راسل الإدارة» — one thread per member; mirrors server/src/contact/service.ts. */
export type ContactMessage = {
  id: string;
  from: 'member' | 'admin';
  by: string | null;
  text: string;
  at: string;
};
export type ContactThread = {
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  cardNumber: string;
  messages: ContactMessage[];
  updatedAt: string;
};
export type ContactThreadSummary = {
  contactId: number;
  name: string;
  personaLabel: string;
  cardNumber: string;
  lastText: string;
  lastFrom: 'member' | 'admin';
  updatedAt: string;
  unread: number;
};

/** M11 «شخصية ومسيرة» — mirrors server/src/profiles/service.ts. */
export type ProfileLink = { label: string; url: string };
export type ProfileFields = {
  name: string;
  title: string;
  company: string;
  /** M73: the spotlight sections (absent on profiles stored before it). */
  specialty?: string;
  city?: string;
  bio: string;
  milestones: string[];
  achievements?: string[];
  benefit?: string[];
  seeking?: string;
  phone?: string;
  email?: string;
  links: ProfileLink[];
  photo: string | null;
};
export type ProfileStatus = 'pending' | 'approved' | 'rejected';
export type Profile = {
  id: string;
  contactId: number | null;
  memberNumber: string;
  status: ProfileStatus;
  fields: ProfileFields;
  /** A member's resubmission awaiting review while `fields` stays public. */
  draft: ProfileFields | null;
  note: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};
export type ProfilesConfig = { intro: string };

/** M16: a registration-form submission — mirrors server/src/forms/service.ts. */
export type FormSubmission = {
  id: string;
  formKey: string;
  formTitle: string;
  contactId: number | null;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  answers: { key: string; label: string; value: string }[];
  createdAt: string;
  handled: boolean;
  handledBy: string | null;
  handledAt: string | null;
  status?: RequestStatus;
  adminNote?: string | null;
};
export type FormInfo = { key: string; title: string; open: boolean };
export type NotifySettings = { recipients: string[]; source: 'dashboard' | 'env'; envRecipients: string[]; by: string | null; at: string | null };

/** M10: a workshop interest registration from «دليل المحايد» — mirrors server/src/workshops/service.ts. */
export type WorkshopRegistration = {
  id: string;
  workshopId: string;
  workshopTitle: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  note: string;
  createdAt: string;
  status?: RequestStatus;
  decidedAt?: string | null;
  decidedBy?: string | null;
  adminNote?: string | null;
};

/** M41 «أجندة النادي» — mirrors server/src/agenda/service.ts. */
export type AgendaMode = 'hq' | 'online' | 'both';
export type AgendaEventInput = {
  title: string;
  blurb: string;
  date: string;
  /** M70: every day a multi-day workshop runs (the server sorts, dedupes and mirrors `date` = first day); [] or absent = single day. */
  dates?: string[];
  time: string;
  endTime: string;
  place: string;
  onlineUrl: string;
  /** M77: the big hero image above the event details (uploaded here, shown in the app). */
  imageUrl?: string | null;
  /** M167: the square card image — the cards outside the event page (home, agenda list, inbox); absent = the hero. */
  coverUrl?: string | null;
  mode: AgendaMode;
  feeSar: number;
  /** M107: the ACTIVE member's price (0 = ضمن العضوية). */
  memberFeeSar?: number;
  /** M107: the unified interest keys this event suits. */
  interests?: string[];
  open: boolean;
};
export type AgendaEvent = AgendaEventInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  counts: { hq: number; online: number; confirmed: number; awaitingPayment: number };
  /** M43: the event's English — AI once, the owner's edit wins (`enAuto: false`). */
  en?: { title: string; blurb: string; place: string | null } | null;
  enAuto?: boolean;
};
export type AgendaRegistration = {
  id: string;
  eventId: string;
  contactId: number;
  name: string;
  phone: string;
  email: string;
  personaLabel: string;
  attendance: 'hq' | 'online';
  member: boolean;
  paid: boolean;
  paymentId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** M107: the discount code used and what was actually paid. */
  discountCode?: string | null;
  amountSar?: number;
};

/** M107 «أكواد الخصم» — mirrors server/src/discounts/service.ts. */
export type DiscountCode = {
  code: string;
  percent: number;
  maxUses: number;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  used: number;
};
export type DiscountCodeInput = Pick<DiscountCode, 'code' | 'percent' | 'maxUses' | 'startsAt' | 'endsAt' | 'enabled' | 'note'>;
export type DiscountUse = {
  code: string;
  contactId: number;
  name: string;
  context: string;
  label: string;
  amountBefore: number;
  amountAfter: number;
  paymentId: string | null;
  at: string;
};

// M116 «تقييمات المشاريع»: stars + comments on the Projects Bank, fed by the app and by hand.
export type RatingRow = {
  projectId: number;
  title: string;
  number: string | null;
  /** What the app shows: the pinned value when set, else the average. */
  stars: number | null;
  average: number | null;
  count: number;
  hiddenCount: number;
  override: number | null;
  latestAt: string | null;
};
export type RatingCatalogEntry = { id: number; title: string; number: string | null };
export type RatingReview = {
  id: string;
  projectId: number;
  stars: number;
  comment: string;
  source: 'member' | 'manual';
  contactId: number | null;
  name: string;
  photoUrl: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ManualReviewInput = { name: string; stars: number; comment: string; photoUrl: string };

/** M107 «الاهتمامات» — mirrors server/src/interests. */
export type InterestsReport = {
  total: number;
  counts: { key: string; label: string; count: number }[];
  others: { contactId: number; text: string; updatedAt: string }[];
};

/** M44 «روابط الدفع» — mirrors server/src/paylinks/service.ts. */
export type PayLinkKind = 'membership' | 'workshop' | 'other';
export type PayLink = {
  id: string;
  kind: PayLinkKind;
  label: string;
  amountSar: number;
  /** M108b: a permanent link mints a fresh invoice per visitor and never expires. */
  permanent?: boolean;
  days: number | null;
  contactId: number | null;
  contactName: string;
  customer: { name: string; phone: string; email: string };
  paymentId: string;
  checkoutUrl: string;
  createdBy: string;
  createdAt: string;
  paidAt: string | null;
  activation: 'auto' | 'done' | 'failed' | 'none';
  activationNote: string | null;
  status?: 'created' | 'paid' | 'failed';
};
export type PayLinkInput = {
  kind: PayLinkKind;
  label: string;
  amountSar: number;
  days: number;
  permanent?: boolean;
  customer: { name: string; phone: string; email: string };
};

export type UploadKind = 'image' | 'video';
export type UploadLimits = { types: string[]; maxBytes: number };
/** `durable: false`: files sit on the server's temporary disk and vanish on the next deploy. */
export type UploadConfig = { images: UploadLimits; videos: UploadLimits; durable: boolean };
/** Where the bytes go: a presigned multipart POST to the bucket, or a raw PUT to the API's token URL. */
export type UploadTarget =
  | { method: 'POST'; url: string; fields: Record<string, string> }
  | { method: 'PUT'; url: string; headers: Record<string, string> };
export type UploadTicket = { key: string; url: string; kind: UploadKind; upload: UploadTarget };
export type Uploaded = { url: string; kind: UploadKind; key: string };

/** Carries the server's own Arabic message so the page can show it as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private windows: the session then lasts until the tab closes.
    }
  },
};

async function call<T>(method: string, path: string, body?: unknown, token: string | null = session.get()): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.', 0, 'network');
  }
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    // M18/M140: a session that lacks the e-mailed code or the authenticator step is over — back to the sign-in page.
    if (response.status === 403 && token && (data?.error?.code === 'otp_required' || data?.error?.code === 'totp_required')) {
      session.set(null);
      window.location.reload();
    }
    throw new ApiError(data?.error?.message ?? 'حدث خطأ غير متوقع', response.status, data?.error?.code ?? 'error');
  }
  return data as T;
}

/** A query string from the set values only: the server's defaults cover the rest. */
function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(name, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

type Paging = { q?: string; page?: number; perPage?: number };
const paging = ({ q, page, perPage }: Paging) => ({ q, page, per_page: perPage });

/** One id per tap: the server replays the first answer when the same write arrives twice. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(12, '0');
}

export const api = {
  login: async (login: string, password: string): Promise<AdminLoginResult> => {
    try {
      return await call<AdminLoginResult>('POST', '/api/admin/auth/login', { login, password }, null);
    } catch (failure) {
      // A server from before M18 has no such route (and no e-mailed code): sign in the old way.
      // A server that has the route never answers not_found here, so this cannot skip the code.
      if (failure instanceof ApiError && failure.status === 404 && failure.code === 'not_found') {
        return call<LoginResult>('POST', '/api/auth/login', { login, password }, null);
      }
      throw failure;
    }
  },
  otpVerify: (challengeToken: string, code: string) => call<LoginResult>('POST', '/api/admin/auth/verify', { challengeToken, code }, null),
  otpResend: (challengeToken: string) => call<{ seconds: number; resendAfter: number }>('POST', '/api/admin/auth/resend', { challengeToken }, null),
  // M140: the authenticator step of the dashboard sign-in, and the account's own authenticator settings.
  totpVerify: (stepToken: string, code: string) => call<LoginResult>('POST', '/api/admin/auth/totp/verify', { stepToken, code }, null),
  totpEnroll: (setupToken: string, code: string) => call<LoginResult & { backupCodes: string[] }>('POST', '/api/admin/auth/totp/enroll', { setupToken, code }, null),
  totpStatus: () => call<TotpStatus>('GET', '/api/me/totp'),
  totpSetup: (code?: string) => call<TotpSetup>('POST', '/api/me/totp/setup', code ? { code } : {}),
  totpConfirm: (setupToken: string, code: string) => call<{ backupCodes: string[] }>('POST', '/api/me/totp/confirm', { setupToken, code }),
  totpBackup: (code: string) => call<{ backupCodes: string[] }>('POST', '/api/me/totp/backup', { code }),
  verify: (pendingToken: string, code: string) => call<LoginResult>('POST', '/api/auth/verify', { pendingToken, code }, null),
  me: () => call<{ me: Me }>('GET', '/api/me?fresh=1'),
  logout: (token?: string) => call<unknown>('POST', '/api/auth/logout', {}, token),
  posts: () => call<{ posts: Post[]; devices: number }>('GET', '/api/admin/posts'),
  cardRequests: () => call<{ requests: CardRequest[] }>('GET', '/api/admin/card-requests'),
  cardRequestDone: (id: string) => call<{ request: CardRequest }>('POST', `/api/admin/card-requests/${id}/done`),
  cardRequestStatus: (id: string, status: RequestStatus, note = '') => call<{ request: CardRequest }>('POST', `/api/admin/card-requests/${id}/status`, { status, note }),
  memberRequests: () => call<{ requests: LedgerEntry[] }>('GET', '/api/admin/requests'),
  memberRequestStatus: (id: string, status: RequestStatus, note = '') => call<{ request: LedgerEntry }>('POST', `/api/admin/requests/${id}/status`, { status, note }),
  workshopStatus: (id: string, status: RequestStatus, note = '') => call<{ registration: WorkshopRegistration }>('POST', `/api/admin/workshops/${id}/status`, { status, note }),
  formStatus: (id: string, status: RequestStatus, note = '') => call<{ submission: FormSubmission }>('POST', `/api/admin/forms/${id}/status`, { status, note }),
  contactThreads: () => call<{ threads: ContactThreadSummary[] }>('GET', '/api/admin/contact'),
  contactThread: (contactId: number) => call<{ thread: ContactThread }>('GET', `/api/admin/contact/${contactId}`),
  contactReply: (contactId: number, text: string) => call<{ message: ContactMessage }>('POST', `/api/admin/contact/${contactId}/reply`, { text }),
  invites: () => call<{ invites: InviteRecord[]; config: InvitesConfig }>('GET', '/api/admin/invites'),
  inviteGift: (id: string, note: string) => call<{ invite: InviteRecord }>('POST', `/api/admin/invites/${id}/gift`, { note }),
  invitesConfig: (input: Partial<InvitesConfig>) => call<{ config: InvitesConfig }>('POST', '/api/admin/invites/config', input),
  createPost: (input: PostInput) => call<{ post: Post }>('POST', '/api/admin/posts', input),
  updatePost: (id: string, input: PostInput) => call<{ post: Post }>('PUT', `/api/admin/posts/${id}`, input),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/posts/${id}`),
  notifyPost: (id: string) => call<{ ok: true; sent: number; failed: number; dropped: number }>('POST', `/api/admin/posts/${id}/notify`),
  // M158: the downloads card and its «حدّث الآن».
  downloads: () => call<Downloads>('GET', '/api/admin/downloads'),
  downloadsSnapshot: () => call<Downloads>('POST', '/api/admin/downloads/snapshot'),
  home: (days: number) => call<Home>('GET', `/api/admin/home${query({ days })}`),
  accounts: (input: Paging & { state?: AccountFilter; persona?: PersonaFilter }) =>
    call<AccountsResult>('GET', `/api/admin/accounts${query({ ...paging(input), state: input.state, persona: input.persona })}`),
  // M86: the members-by-category counts behind the persona buttons.
  personas: (state: 'member' | 'all') => call<Personas>('GET', `/api/admin/personas?state=${state}`),
  account: (id: number) => call<MemberDetail>('GET', `/api/admin/accounts/${id}`),
  hubPayments: (input: Paging & { status?: 'all' | 'ok' | 'failed'; action?: string }) =>
    call<Listed<HubPayment> & { sum_cents_ok: number }>('GET', `/api/admin/hub-payments${query({ ...paging(input), status: input.status, action: input.action })}`),
  appPayments: () => call<{ payments: AppPayment[] }>('GET', '/api/admin/payments'),
  storePurchases: () => call<{ events: StorePurchase[] }>('GET', '/api/admin/membership/purchases'),
  tickets: (input: Paging) => call<Listed<Ticket>>('GET', `/api/admin/tickets${query(paging(input))}`),
  leads: (input: Paging & { ltype?: string }) => call<Listed<Lead>>('GET', `/api/admin/leads${query({ ...paging(input), ltype: input.ltype })}`),
  threads: (input: Paging & { filter?: ThreadFilter }) => call<Listed<Thread>>('GET', `/api/admin/threads${query({ ...paging(input), filter: input.filter })}`),
  thread: (id: number, before?: number) => call<ThreadDetail>('GET', `/api/admin/threads/${id}${query({ before })}`),
  reply: (id: number, text: string, requestId: string) => call<{ ok: true; message_id: number; already: boolean }>('POST', `/api/admin/threads/${id}/reply`, { text, requestId, confirm: true }),
  mail: () => call<{ ok: true; stats: MailStats; items: MailItem[] }>('GET', '/api/admin/mail'),
  grant: (id: number, input: { action: GrantAction; days: number | null } & WriteMeta) =>
    call<{ ok: true; already: boolean }>('POST', `/api/admin/accounts/${id}/grant`, { action: input.action, ...(input.days !== null ? { days: input.days } : {}), note: input.note, requestId: input.requestId, confirm: true }),
  setRole: (id: number, input: { role: 'member' | 'publisher' } & WriteMeta) => call<{ ok: true; already: boolean }>('POST', `/api/admin/accounts/${id}/role`, { ...input, confirm: true }),
  pbGrant: (id: number, input: { amount: number } & WriteMeta) => call<{ ok: true; already: boolean; granted: number; left: number }>('POST', `/api/admin/accounts/${id}/pb-grant`, { ...input, confirm: true }),
  audit: (limit = 100) => call<{ entries: AuditEntry[] }>('GET', `/api/admin/audit${query({ limit })}`),
  analytics: (days: number) => call<AnalyticsResult>('GET', `/api/admin/analytics${query({ days })}`),
  newsSources: () => call<NewsSourcesResult>('GET', '/api/admin/news/sources'),
  toggleNewsSource: (id: string, enabled: boolean) => call<{ ok: true; source: NewsSourceRow }>('POST', `/api/admin/news/sources/${id}`, { enabled }),
  refreshNews: () => call<{ ok: true; running: boolean }>('POST', '/api/admin/news/refresh', {}),
  contentValues: () => call<ContentValues>('GET', '/api/admin/content/values'),
  /** `value: null` goes back to the seed's own value. */
  saveContentValue: (input: { block: string; path: string; value: number | string | boolean | null }) =>
    call<{ ok: true; value: number | string | boolean; edit: { by: string; at: string } | null }>('PUT', '/api/admin/content/value', input),
  content: () => call<ContentList>('GET', '/api/admin/content'),
  /** `value: null` goes back to the block's own text. */
  saveContent: (input: { lang: WordingLang; block: string; path: string; value: string | null }) => call<{ ok: true; edit: WordingEdit | null }>('PUT', '/api/admin/content', input),
  strings: () => call<WordingList>('GET', '/api/admin/strings'),
  /** `value: null` goes back to the app's own text. */
  saveString: (input: { lang: WordingLang; key: string; value: string | null }) => call<{ ok: true; edit: WordingEdit | null }>('PUT', '/api/admin/strings', input),
  uploadsConfig: () => call<UploadConfig>('GET', '/api/admin/uploads/config'),
  uploadTicket: (file: { filename: string; contentType: string; size: number }) => call<UploadTicket>('POST', '/api/admin/uploads', file),
  profiles: () => call<{ profiles: Profile[]; config: ProfilesConfig }>('GET', '/api/admin/profiles'),
  createProfile: (input: { contactId: number | null; fields: ProfileFields }) => call<{ profile: Profile }>('POST', '/api/admin/profiles', input),
  updateProfile: (id: string, input: Partial<ProfileFields> & { order?: number }) => call<{ profile: Profile }>('PUT', `/api/admin/profiles/${id}`, input),
  decideProfile: (id: string, action: 'approve' | 'reject', note = '') => call<{ profile: Profile }>('POST', `/api/admin/profiles/${id}/decision`, { action, note }),
  // M7/M109a «حجوزات المقر»: approve confirms the slot (pass + push + hours deducted); reject frees it.
  hqVisits: (status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled') => call<{ visits: HqVisit[] }>('GET', `/api/admin/hq/visits${status ? `?status=${status}` : ''}`),
  decideHqVisit: (id: string, status: 'confirmed' | 'rejected', note = '') => call<{ visit: HqVisit }>('POST', `/api/admin/hq/visits/${id}/decision`, { status, note }),
  // M109d «طلبات تغيير الصفة»: approve applies the persona at the hub and pushes to the member.
  personaRequests: () => call<{ requests: PersonaChangeRequest[] }>('GET', '/api/admin/persona-requests'),
  decidePersonaRequest: (id: string, action: 'approve' | 'reject', note = '') =>
    call<{ request: PersonaChangeRequest }>('POST', `/api/admin/persona-requests/${id}/decision`, { action, note }),
  deleteProfile: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/profiles/${id}`),
  profilesConfig: (input: ProfilesConfig) => call<{ config: ProfilesConfig }>('PUT', '/api/admin/profiles/config', input),
  workshopRegistrations: () => call<{ registrations: WorkshopRegistration[] }>('GET', '/api/admin/workshops'),
  formSubmissions: () => call<{ submissions: FormSubmission[]; forms: FormInfo[] }>('GET', '/api/admin/forms'),
  formHandled: (id: string, handled: boolean) => call<{ submission: FormSubmission }>('POST', `/api/admin/forms/${id}/handled`, { handled }),
  notifySettings: () => call<{ settings: NotifySettings }>('GET', '/api/admin/notify'),
  saveNotifySettings: (recipients: string[]) => call<{ settings: NotifySettings }>('PUT', '/api/admin/notify', { recipients }),
  resetNotifySettings: () => call<{ settings: NotifySettings }>('DELETE', '/api/admin/notify'),
  agenda: () => call<{ events: AgendaEvent[] }>('GET', '/api/admin/agenda'),
  createAgendaEvent: (input: AgendaEventInput & { english?: { title: string; blurb: string; place: string } | null }) => call<{ event: AgendaEvent }>('POST', '/api/admin/agenda', input),
  updateAgendaEvent: (id: string, input: Partial<AgendaEventInput> & { english?: { title: string; blurb: string; place: string } | null }) => call<{ event: AgendaEvent }>('PUT', `/api/admin/agenda/${id}`, input),
  deleteAgendaEvent: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/agenda/${id}`),
  agendaRegistrations: (id: string) => call<{ registrations: AgendaRegistration[] }>('GET', `/api/admin/agenda/${id}/registrations`),
  notifyAgendaEvent: (id: string) => call<{ ok: true; sent: number; failed: number; dropped: number }>('POST', `/api/admin/agenda/${id}/notify`, {}),
  // M107 «أكواد الخصم» والاهتمامات.
  discounts: () => call<{ codes: DiscountCode[] }>('GET', '/api/admin/discounts'),
  createDiscount: (input: DiscountCodeInput) => call<{ code: DiscountCode }>('POST', '/api/admin/discounts', input),
  updateDiscount: (code: string, patch: Partial<DiscountCodeInput>) => call<{ code: DiscountCode }>('PUT', `/api/admin/discounts/${encodeURIComponent(code)}`, patch),
  deleteDiscount: (code: string) => call<{ ok: true }>('DELETE', `/api/admin/discounts/${encodeURIComponent(code)}`),
  discountUses: (code: string) => call<{ uses: DiscountUse[] }>('GET', `/api/admin/discounts/${encodeURIComponent(code)}/uses`),
  // M116 «تقييمات المشاريع»
  ratings: () => call<{ rows: RatingRow[]; catalog: RatingCatalogEntry[] }>('GET', '/api/admin/ratings'),
  ratingReviews: (projectId: number) => call<{ reviews: RatingReview[]; summary: { stars: number | null; count: number } }>('GET', `/api/admin/ratings/${projectId}`),
  addRatingReview: (projectId: number, input: ManualReviewInput) => call<{ review: RatingReview }>('POST', `/api/admin/ratings/${projectId}/reviews`, input),
  updateRatingReview: (id: string, patch: Partial<ManualReviewInput> & { hidden?: boolean }) => call<{ review: RatingReview }>('PUT', `/api/admin/ratings/reviews/${encodeURIComponent(id)}`, patch),
  deleteRatingReview: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/ratings/reviews/${encodeURIComponent(id)}`),
  setRatingOverride: (projectId: number, stars: number | null) => call<{ ok: true; summary: { stars: number | null; count: number } }>('PUT', `/api/admin/ratings/${projectId}/override`, { stars }),
  interestsReport: () => call<InterestsReport>('GET', '/api/admin/interests'),
  paylinks: () => call<{ links: PayLink[] }>('GET', '/api/admin/paylinks'),
  createPaylink: (input: PayLinkInput) => call<{ link: PayLink }>('POST', '/api/admin/paylinks', input),
  // M87b «المستشار اليومي»: the daily-push template pools, their preview, and the mute count.
  companion: () => call<CompanionData>('GET', '/api/admin/companion'),
  saveCompanion: (templates: CompanionTemplates) => call<CompanionData & { ok: true }>('PUT', '/api/admin/companion', templates),
  resetCompanion: () => call<CompanionData & { ok: true }>('DELETE', '/api/admin/companion'),
  // M81 «صور التطبيق»: code-defined image slots the owner fills with uploads.
  contentImages: () => call<{ slots: ImageSlot[] }>('GET', '/api/admin/content/images'),
  saveContentImage: (key: string, url: string | null) => call<{ ok: true; slot: ImageSlot }>('PUT', '/api/admin/content/image', { key, url }),
  partners: () => call<{ settings: PartnersSettings; partners: Partner[] }>('GET', '/api/admin/partners'),
  createPartner: (input: PartnerInput) => call<{ partner: Partner }>('POST', '/api/admin/partners', input),
  updatePartner: (id: string, input: Partial<PartnerInput>) => call<{ partner: Partner }>('PUT', `/api/admin/partners/${id}`, input),
  deletePartner: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/partners/${id}`),
  savePartnersSettings: (input: Partial<PartnersSettings>) => call<{ settings: PartnersSettings }>('PUT', '/api/admin/partners/settings', input),
  promoLookup: (code: string) => call<{ promo: PromoRecord | null }>('GET', `/api/admin/partners/promo/${encodeURIComponent(code)}`),
};

/** M81 «صور التطبيق» — mirrors server/src/content/images.ts. */
export type ImageSlot = { key: string; label: string; group: string; url: string | null };

/** M87b «المستشار اليومي» — mirrors server/src/companion/service.ts. */
export type CompanionPersona = 'investor' | 'entrepreneur' | 'neutral';
export type CompanionTemplate = { title: string; body: string };
export type CompanionTemplates = Record<CompanionPersona, CompanionTemplate[]>;
export type CompanionData = {
  templates: CompanionTemplates;
  edited: boolean;
  enabled: boolean;
  lastDay: string | null;
  mutedCount: number;
  preview: Record<CompanionPersona, CompanionTemplate>;
  placeholders: { key: string; label: string }[];
};

/** M68 «شركاؤنا» — mirrors server/src/partners/service.ts. */
export type Partner = {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  discount: string;
  discountEn: string;
  /** M123: the short headline on the card's gold ribbon; empty = no ribbon. */
  ribbon: string;
  ribbonEn: string;
  url: string;
  /** Owner (2026-10-25): a number here turns the card's button into a direct WhatsApp handover. */
  whatsapp: string;
  logoUrl: string | null;
  order: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};
export type PartnerInput = {
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  discount?: string;
  discountEn?: string;
  ribbon?: string;
  ribbonEn?: string;
  url: string;
  whatsapp?: string;
  logoUrl?: string | null;
  order?: number;
  visible?: boolean;
};
export type PartnersSettings = {
  title: string;
  titleEn: string;
  intro: string;
  introEn: string;
  codeTitle: string;
  codeTitleEn: string;
  codeHint: string;
  codeHintEn: string;
  membersOnlyText: string;
  membersOnlyTextEn: string;
};
export type PromoRecord = { code: string; contactId: number; name: string; persona: string; personaLabel: string; cardNumber: string; issuedAt: string };

const TRANSFER_FAILED = 'تعذر رفع الملف. تحقق من الإنترنت ثم حاول مرة أخرى.';
const cancelled = () => new ApiError('تم إلغاء الرفع.', 0, 'aborted');

/** The API's token URL answers errors in our JSON shape; the bucket answers XML, which falls back to the generic message. */
function transferError(xhr: XMLHttpRequest): ApiError {
  let message: string | undefined;
  try {
    message = (JSON.parse(xhr.responseText) as { error?: { message?: string } } | null)?.error?.message;
  } catch {
    // Not JSON.
  }
  return new ApiError(message ?? TRANSFER_FAILED, xhr.status, 'upload_failed');
}

/** Sends the bytes to the ticket's URL. XMLHttpRequest because fetch reports no upload progress. Never carries the Authorization header: the URL is the bucket, or holds its own token. */
function transfer(target: UploadTarget, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    let body: FormData | File = file;
    if (target.method === 'POST') {
      // The bucket reads the policy fields before the file: fields in the given order, the file last.
      const form = new FormData();
      for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
      form.append('file', file);
      body = form;
    } else {
      for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(transferError(xhr)));
    xhr.onerror = () => reject(new ApiError(TRANSFER_FAILED, 0, 'network'));
    xhr.onabort = () => reject(cancelled());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Asks the API for an upload ticket, sends the file where the ticket says, and answers the stable URL to store in the post. `onProgress` gets 0 to 1. */
export async function uploadFile(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Uploaded> {
  if (signal?.aborted) throw cancelled();
  const ticket = await api.uploadTicket({ filename: file.name, contentType: file.type, size: file.size });
  await transfer(ticket.upload, file, onProgress, signal);
  onProgress?.(1);
  return { url: ticket.url, kind: ticket.kind, key: ticket.key };
}
