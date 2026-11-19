import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M256 (owner, 2026-11-19: «حاجات تسهل التسجيل أكتر»): what a member typed on the sign-up form, kept on his own
 * phone for a day — he leaves for WhatsApp to read the code, the system closes the app behind him, and he comes
 * back to an empty form. The password is NEVER kept, nor the proof of the number; the draft goes the moment the
 * account exists.
 */
const KEY = 'investorsclub.signup.draft';
const FRESH_MS = 24 * 60 * 60_000;

export type SignupDraft = { name: string; country: string; phone: string; email: string; persona: string; jobTitle: string; inviteCode: string };
const FIELDS: (keyof SignupDraft)[] = ['name', 'country', 'phone', 'email', 'persona', 'jobTitle', 'inviteCode'];

export async function loadSignupDraft(): Promise<SignupDraft | null> {
  try {
    const raw = await loadSetting(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { at?: unknown; form?: Record<string, unknown> };
    if (typeof stored.at !== 'number' || Date.now() - stored.at > FRESH_MS || !stored.form) {
      void saveSetting(KEY, null);
      return null;
    }
    const draft = {} as SignupDraft;
    for (const field of FIELDS) {
      const value = stored.form[field];
      draft[field] = typeof value === 'string' ? value.slice(0, 200) : '';
    }
    return draft;
  } catch {
    return null;
  }
}

/** Keeps the draft; a form with nothing typed keeps nothing. */
export function saveSignupDraft(form: SignupDraft): void {
  const draft = {} as SignupDraft;
  for (const field of FIELDS) draft[field] = form[field];
  const typed = Boolean(draft.name.trim() || draft.phone.trim() || draft.email.trim() || draft.jobTitle.trim());
  void saveSetting(KEY, typed ? JSON.stringify({ at: Date.now(), form: draft }) : null).catch(() => undefined);
}

export function clearSignupDraft(): void {
  void saveSetting(KEY, null).catch(() => undefined);
}
