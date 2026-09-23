import type { AccountFilter, AccountsResult, AnalyticsResult, AppPayment, AuditEntry, ContentList, ContentValues, GrantAction, Home, HubPayment, Lead, Listed, MailItem, MailStats, MemberDetail, NewsSourceRow, NewsSourcesResult, StorePurchase, Thread, ThreadDetail, ThreadFilter, Ticket, WordingEdit, WordingLang, WordingList, WriteMeta } from './types';

// Public value: the TEST API. A production dashboard gets its URL from VITE_API_URL at build time.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://vibes-holding-app-production.up.railway.app';
const TOKEN_KEY = 'club-admin-token';

export type Me = { id: number; name: string; email: string; isAdmin: boolean; isModerator: boolean };
export type LoginResult =
  | { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string }
  | { pending: false; otp?: undefined; token: string; me: Me };
/** The password was right and the server e-mailed a short-lived code: the session starts after it (M18). */
export type OtpStep = { pending: false; otp: true; challengeToken: string; email: string; seconds: number; resendAfter: number };
export type AdminLoginResult = LoginResult | OtpStep;

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
  status: 'pending' | 'done';
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
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
  bio: string;
  milestones: string[];
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
};

/** M41 «أجندة النادي» — mirrors server/src/agenda/service.ts. */
export type AgendaMode = 'hq' | 'online' | 'both';
export type AgendaEventInput = {
  title: string;
  blurb: string;
  date: string;
  time: string;
  endTime: string;
  place: string;
  onlineUrl: string;
  mode: AgendaMode;
  feeSar: number;
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
};

/** M44 «روابط الدفع» — mirrors server/src/paylinks/service.ts. */
export type PayLinkKind = 'membership' | 'workshop' | 'other';
export type PayLink = {
  id: string;
  kind: PayLinkKind;
  label: string;
  amountSar: number;
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
  verify: (pendingToken: string, code: string) => call<LoginResult>('POST', '/api/auth/verify', { pendingToken, code }, null),
  me: () => call<{ me: Me }>('GET', '/api/me?fresh=1'),
  logout: (token?: string) => call<unknown>('POST', '/api/auth/logout', {}, token),
  posts: () => call<{ posts: Post[]; devices: number }>('GET', '/api/admin/posts'),
  cardRequests: () => call<{ requests: CardRequest[] }>('GET', '/api/admin/card-requests'),
  cardRequestDone: (id: string) => call<{ request: CardRequest }>('POST', `/api/admin/card-requests/${id}/done`),
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
  home: (days: number) => call<Home>('GET', `/api/admin/home${query({ days })}`),
  accounts: (input: Paging & { state?: AccountFilter }) => call<AccountsResult>('GET', `/api/admin/accounts${query({ ...paging(input), state: input.state })}`),
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
  deleteProfile: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/profiles/${id}`),
  profilesConfig: (input: ProfilesConfig) => call<{ config: ProfilesConfig }>('PUT', '/api/admin/profiles/config', input),
  workshopRegistrations: () => call<{ registrations: WorkshopRegistration[] }>('GET', '/api/admin/workshops'),
  agenda: () => call<{ events: AgendaEvent[] }>('GET', '/api/admin/agenda'),
  createAgendaEvent: (input: AgendaEventInput & { english?: { title: string; blurb: string; place: string } | null }) => call<{ event: AgendaEvent }>('POST', '/api/admin/agenda', input),
  updateAgendaEvent: (id: string, input: Partial<AgendaEventInput> & { english?: { title: string; blurb: string; place: string } | null }) => call<{ event: AgendaEvent }>('PUT', `/api/admin/agenda/${id}`, input),
  deleteAgendaEvent: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/agenda/${id}`),
  agendaRegistrations: (id: string) => call<{ registrations: AgendaRegistration[] }>('GET', `/api/admin/agenda/${id}/registrations`),
  notifyAgendaEvent: (id: string) => call<{ ok: true; sent: number; failed: number; dropped: number }>('POST', `/api/admin/agenda/${id}/notify`, {}),
  paylinks: () => call<{ links: PayLink[] }>('GET', '/api/admin/paylinks'),
  createPaylink: (input: PayLinkInput) => call<{ link: PayLink }>('POST', '/api/admin/paylinks', input),
};

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
