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

// M164's weekly membership slot (`membership.autoPrompt.at`) left with M170 (owner, 2026-10-31):
// no membership pitch opens by itself any more — only the member's own tap on something
// members-only opens the store popup (MembershipGate.showMembershipGate).
