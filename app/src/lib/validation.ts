// Light client-side checks; the hub enforces the real rules and answers in Arabic.

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim().toLowerCase());
}

/** Validates a local mobile number against the country pattern sent by the server. */
export function isLocalPhone(value: string, pattern: string | undefined): boolean {
  const digits = value.replace(/\D+/g, '');
  if (!pattern) return digits.length >= 8 && digits.length <= 12;
  try {
    return new RegExp(pattern).test(digits);
  } catch {
    return digits.length >= 8;
  }
}

/** True when the login field looks like a phone number rather than an e-mail. */
export function looksLikePhone(value: string): boolean {
  return /^[\d\s+()-]+$/.test(value.trim());
}
