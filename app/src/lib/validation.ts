// Light client-side checks; the hub enforces the real rules and answers in Arabic.

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim().toLowerCase());
}

export type PhoneRules = { pattern?: string; min?: number; max?: number; starts?: string[] };

/**
 * M128: checks a local mobile number against the country's rules (length + leading digits).
 * Returns 'bad' when the digits can no longer become a valid number (wrong start, too long,
 * or complete but failing the server pattern), 'short' while still typing, null when valid.
 */
export function phoneIssue(value: string, rules: PhoneRules | undefined): 'bad' | 'short' | null {
  const digits = value.replace(/\D+/g, '').replace(/^0+/, '');
  const min = rules?.min ?? 8;
  const max = rules?.max ?? 12;
  const starts = rules?.starts ?? [];
  if (!digits) return 'short';
  const startLen = starts[0]?.length ?? 0;
  if (starts.length && digits.length >= startLen && !starts.some((start) => digits.startsWith(start))) return 'bad';
  if (digits.length > max) return 'bad';
  if (digits.length < min) return 'short';
  // The number is complete: the server pattern has the final say.
  if (rules?.pattern) {
    try {
      return new RegExp(rules.pattern).test(digits) ? null : 'bad';
    } catch {
      return null;
    }
  }
  return null;
}

/** True when the login field looks like a phone number rather than an e-mail. */
export function looksLikePhone(value: string): boolean {
  return /^[\d\s+()-]+$/.test(value.trim());
}
