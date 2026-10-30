import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M128 (owner, 2026-10-26): «طالما طلع pop up يبقى مينفعش أبدًا يظهر التاني» — every
 * self-opening popup claims this single slot before showing; the slot frees only with a
 * fresh JS launch, so one app session never stacks a second automatic popup on the first.
 * User-opened dialogs (the store popup behind a button) are not gated.
 */
let claimed = false;

export function claimAutoPopup(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}

/**
 * M164 (owner, 2026-10-30, after many member complaints): the membership pitch opens BY ITSELF
 * at most ONCE A WEEK per device — across every automatic door (the launch nudge, the service
 * upsell, the after-form nudge). Any other time it shows only when the member taps something
 * members-only. The week is remembered on the device, so a relaunch does not reset it.
 */
const WEEKLY_KEY = 'membership.autoPrompt.at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// One read of the stored week per launch, shared by every door that asks.
let weekOpen: Promise<boolean> | null = null;

export async function claimWeeklyMembershipPrompt(): Promise<boolean> {
  if (claimed) return false;
  if (!weekOpen) {
    weekOpen = loadSetting(WEEKLY_KEY)
      .then((last) => Date.now() - (Number(last) || 0) >= WEEK_MS)
      .catch(() => false);
  }
  if (!(await weekOpen)) return false;
  // The sync slot decides between doors that asked at the same time: only the first one wins.
  if (!claimAutoPopup()) return false;
  weekOpen = Promise.resolve(false);
  void saveSetting(WEEKLY_KEY, String(Date.now())).catch(() => undefined);
  return true;
}
