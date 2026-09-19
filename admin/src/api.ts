// Public value: the TEST API. A production dashboard gets its URL from VITE_API_URL at build time.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://vibes-holding-app-production.up.railway.app';
const TOKEN_KEY = 'club-admin-token';

export type Me = { id: number; name: string; email: string; isAdmin: boolean };
export type LoginResult =
  | { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string }
  | { pending: false; token: string; me: Me };

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
};
/** `video` is the YouTube link or id, `videoFile` the uploaded video; a post may carry both. */
export type PostInput = { title: string; body: string; links: PostLink[]; images: string[]; video: string | null; videoFile: PostVideo | null; status: 'draft' | 'published'; pinned: boolean };

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

export const api = {
  login: (login: string, password: string) => call<LoginResult>('POST', '/api/auth/login', { login, password }, null),
  verify: (pendingToken: string, code: string) => call<LoginResult>('POST', '/api/auth/verify', { pendingToken, code }, null),
  me: () => call<{ me: Me }>('GET', '/api/me?fresh=1'),
  logout: () => call<unknown>('POST', '/api/auth/logout', {}),
  posts: () => call<{ posts: Post[]; devices: number }>('GET', '/api/admin/posts'),
  createPost: (input: PostInput) => call<{ post: Post }>('POST', '/api/admin/posts', input),
  updatePost: (id: string, input: PostInput) => call<{ post: Post }>('PUT', `/api/admin/posts/${id}`, input),
  deletePost: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/posts/${id}`),
  notifyPost: (id: string) => call<{ ok: true; sent: number; failed: number; dropped: number }>('POST', `/api/admin/posts/${id}/notify`),
  uploadsConfig: () => call<UploadConfig>('GET', '/api/admin/uploads/config'),
  uploadTicket: (file: { filename: string; contentType: string; size: number }) => call<UploadTicket>('POST', '/api/admin/uploads', file),
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
