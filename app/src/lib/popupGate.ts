import { useEffect, useSyncExternalStore } from 'react';

/**
 * M128 (owner, 2026-10-26): «طالما طلع pop up يبقى مينفعش أبدًا يظهر التاني» — every
 * self-opening popup claims this single slot before showing; the slot frees only with a
 * fresh JS launch, so one app session never stacks a second automatic popup on the first.
 * User-opened dialogs (the store popup behind a button) are not gated.
 */
let claimed = false;
// M195: while the forced-update cover is up no automatic popup may open (a native Modal would sit above the cover).
let blocked = false;
// M209: popups that are open (or about to be) right now. The slot above is once per launch; this is the live «something
// is on screen» signal, so a popup that is sequenced AFTER another one (the WhatsApp confirmation after the intro film
// and the details form) waits for the screen to be free instead of opening on top of it.
let holds = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function blockAutoPopups(value: boolean): void {
  blocked = value;
  emit();
}

/** True while the forced-update cover is up: self-opening popups (the intro video) stay shut. */
export function autoPopupsBlocked(): boolean {
  return blocked;
}

export function claimAutoPopup(): boolean {
  if (claimed || blocked || holds > 0) return false;
  claimed = true;
  return true;
}

/** M209: a sequenced popup that went up marks the launch as used, so no later automatic popup opens beside it. */
export function markAutoPopupUsed(): void {
  claimed = true;
}

/** M209: «a popup is open» — returns the release. */
export function holdAutoPopup(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

/** M209: true while a popup is open (or a popup is deciding whether to open). */
export function autoPopupHeld(): boolean {
  return holds > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when a popup opens or closes. Also false while the forced-update cover is up (nothing may open). */
export function useAutoPopupFree(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holds === 0 && !blocked,
    () => true,
  );
}

/** Holds the screen while `active`; the hold is released when it turns false or the component goes away. */
export function usePopupHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdAutoPopup();
  }, [active]);
}

// M164's weekly membership slot (`membership.autoPrompt.at`) left with M170 (owner, 2026-10-31):
// no membership pitch opens by itself any more — only the member's own tap on something
// members-only opens the store popup (MembershipGate.showMembershipGate).
