// Public value: the TEST API. A production dashboard gets its URL from VITE_API_URL at build time.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://vibes-holding-app-production.up.railway.app';
const TOKEN_KEY = 'club-admin-token';

export type Me = { id: number; name: string; email: string; isAdmin: boolean };
export type LoginResult =
  | { pending: true; pendingToken: string; email: string; mailSent: boolean; text: string }
  | { pending: false; token: string; me: Me };

export type PostLink = { label: string; url: string };
export type Post = {
  id: string;
  title: string;
  body: string;
  links: PostLink[];
  images: string[];
  youtubeId: string | null;
  status: 'draft' | 'published';
  pinned: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  notifiedAt: string | null;
};
export type PostInput = { title: string; body: string; links: PostLink[]; images: string[]; video: string | null; status: 'draft' | 'published'; pinned: boolean };

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
};
