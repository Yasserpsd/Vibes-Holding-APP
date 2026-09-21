import type { FastifyRequest } from 'fastify';

/** Languages of the app (M27). The dashboard stays Arabic. */
export type AppLang = 'ar' | 'en';
export const APP_LANGS: AppLang[] = ['ar', 'en'];

export function isAppLang(value: unknown): value is AppLang {
  return value === 'ar' || value === 'en';
}

/**
 * The language a request wants: `?lang=` wins (dashboard, checks from a browser), then the app's
 * own `x-app-lang` header, sent on every request. Arabic is the default: a browser's
 * `accept-language` is never read, so nobody gets English by accident.
 */
export function langOf(request: FastifyRequest): AppLang {
  const query = (request.query ?? {}) as Record<string, unknown>;
  if (isAppLang(query.lang)) return query.lang;
  const header = request.headers['x-app-lang'];
  const value = (Array.isArray(header) ? header[0] : header)?.trim().toLowerCase();
  return isAppLang(value) ? value : 'ar';
}
