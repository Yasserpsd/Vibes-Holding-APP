import { env } from '@/config/env';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RequestOptions = {
  params?: Params;
  body?: unknown;
  token?: string | null;
  /** How long to wait for the answer. A poller passes less than its interval, so a stalled request never blocks the next tick. */
  timeoutMs?: number;
};

// React Native's Android HTTP client waits forever by itself: without a deadline one stalled connection keeps a
// spinner, or a poller's "request in flight" flag, stuck until the app restarts. The server gives its own upstream
// calls (hub, Projects Bank, Paymob) 30 seconds at most, so a healthy answer is never this late.
const DEFAULT_TIMEOUT_MS = 60_000;

// The auth provider registers the current session token and a handler for rejected sessions.
let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  currentToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// Built by hand: Hermes does not implement URLSearchParams fully.
function buildUrl(path: string, params?: Params): string {
  const query = Object.entries(params ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${env.apiBaseUrl}${path}${query ? `?${query}` : ''}`;
}

export async function apiRequest<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  if (!env.apiBaseUrl) {
    throw new ApiError('عنوان الخادم غير مضبوط في هذه النسخة', 0, 'no_api_url');
  }
  const token = options.token === undefined ? currentToken : options.token;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  // The deadline covers the body too: React Native's fetch resolves once the whole answer has arrived.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.params), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    // No connection, or no answer before the deadline.
    throw new ApiError('تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.', 0, 'network');
  } finally {
    clearTimeout(deadline);
  }

  if (!response.ok) {
    let code = 'http_error';
    let message = 'حدث خطأ أثناء تحميل البيانات';
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    // A rejected session token (expired or revoked) signs the user out everywhere.
    if (response.status === 401 && token && token === currentToken && code !== 'bad_login') onUnauthorized?.();
    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

export async function apiGet<T>(path: string, params?: Params): Promise<T> {
  return apiRequest<T>('GET', path, { params });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع';
}
