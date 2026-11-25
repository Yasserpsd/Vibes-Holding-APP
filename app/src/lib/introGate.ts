import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M209 (owner, 2026-11-06: «الفيديو التعريفي اختفى… عضو سجل ومفيش حاجة اشتغلت»): why the film stopped playing after a
 * registration — its «seen» flag was one per DEVICE (`investorsclub.introSeen.v2`), and a visitor on the same phone had
 * already used it (or the owner's own device had), so every later registration found it spent. Now the film is owed to the
 * ACCOUNT: a new registration marks it due, and each account sees it at most once.
 */
const DUE_KEY = 'investorsclub.introDue';
/** Device-level flag kept for the workshop ad, which only starts after the film has been seen on this phone. */
export const INTRO_DEVICE_SEEN_KEY = 'investorsclub.introSeen.v2';
export const introAccountSeenKey = (accountId: string): string => `investorsclub.introSeen.v3.${accountId}`;

// M277 (owner, 2026-11-25: «خلي اهتماماتي تطلع بعد ما يسجل ويدخل يختارها كده بسرعة»): no sign-up form asks the
// interests any more, so a new account owes them once — the home opens «اهتماماتي» the first time it is shown.
let interestsDue = false;

/** True once after a registration; the caller opens the interests screen. */
export function takeInterestsDue(): boolean {
  const due = interestsDue;
  interestsDue = false;
  return due;
}

// Read synchronously by the host the moment the new session is announced (the storage write is asynchronous).
let dueNow = false;

/** A brand-new account just registered: it owes the film once. Call BEFORE announcing the session. */
export function markIntroDue(): void {
  dueNow = true;
  interestsDue = true;
  void saveSetting(DUE_KEY, '1');
}

export async function introIsDue(): Promise<boolean> {
  return dueNow || Boolean(await loadSetting(DUE_KEY));
}

export function clearIntroDue(): void {
  dueNow = false;
  void saveSetting(DUE_KEY, '');
}
