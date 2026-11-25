import type { Href } from 'expo-router';

import { phoneStepPath, type QuickStartResult } from '@/api/auth';
import { ApiError } from '@/api/client';

/**
 * M272: the number-first entry. The gate and the sign-in screen both ask the server about one number and open the
 * code screen with what it answered; these are the two shapes that road takes.
 */

/** The code screen: `flow=code` signs an account in, `flow=signup` proves a new number before the short form. */
export function quickStepPath(result: QuickStartResult, number: string, country: string): Href {
  const base = phoneStepPath(result);
  if (result.kind === 'signin') return `${base}&flow=code` as Href;
  return `${base}&flow=signup&number=${encodeURIComponent(number)}&country=${encodeURIComponent(country)}${result.needsEmail ? '&needsEmail=1' : ''}` as Href;
}

/**
 * Refusals a code cannot get past, while the password still can: the account does not sign in by code yet, the day's
 * codes are spent, the code sign-in is off, or the number belongs to an account already. The sign-in screen opens
 * with the number filled in and the server's sentence on top, so none of them is a dead end.
 */
export function passwordRoad(cause: unknown, number: string, country: string): Href | null {
  if (!(cause instanceof ApiError) || !['code_login_password', 'code_login_spent', 'code_login_off', 'exists'].includes(cause.code)) return null;
  const params = [`number=${encodeURIComponent(number)}`, `country=${encodeURIComponent(country)}`, `why=${encodeURIComponent(cause.message)}`];
  // That account's number is proven by the password sign-in itself (its WhatsApp code follows).
  if (cause.code === 'code_login_password') params.push('confirm=1');
  return `/auth/login?${params.join('&')}` as Href;
}
