/**
 * M271 «عضوية شركاء النجاح» (owner, 2026-11-25): given by the administration for 360 days, never sold (rule 3). The hub
 * holds it (`partner`, hub 2.33.0, rule 2) and ends it by itself; only an admin sets it, through the dashboard's guarded
 * route. It carries what an active annual membership carries, so `is_member` and `member_end` need no special case —
 * they are the effective ones; `partner_end` / `partner_left` are what the member's card shows.
 */
export const HUB_PARTNER_VERSION = [2, 33, 0];

export function isPartner(contact: { partner?: 0 | 1 | null } | null | undefined): boolean {
  return contact?.partner === 1;
}
