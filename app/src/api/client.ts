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

// Built by hand: Hermes does not implement URLSearchParams fully.
function buildUrl(path: string, params?: Params): string {
  const query = Object.entries(params ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${env.apiBaseUrl}${path}${query ? `?${query}` : ''}`;
}

export async function apiGet<T>(path: string, params?: Params): Promise<T> {
  if (!env.apiBaseUrl) {
    throw new ApiError('عنوان الخادم غير مضبوط في هذه النسخة', 0, 'no_api_url');
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم. تأكد من اتصالك بالإنترنت.', 0, 'network');
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
    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع';
}
