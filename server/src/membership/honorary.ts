import { DAY_MS, riyadhDay, riyadhDayStart } from '../riyadh.js';

/**
 * M205 «عضوية شرفية»: only for official partners in the founding contract («عقد التأسيس») of one of the Vibes Ventures
 * companies (owner, 2026-11-06) — the administration checks that before giving it, and takes it back when the
 * partnership ends. The flag lives in the hub (`honorary`, hub 2.28.0,
 * rule 2) and only an admin sets it, through the dashboard's guarded route. It has no duration: no days left, no end
 * date, no renewal reminder, and no store subscription behind it.
 */
export const HUB_HONORARY_VERSION = [2, 28, 0];

export function isHonorary(contact: { honorary?: 0 | 1 | null } | null | undefined): boolean {
  return contact?.honorary === 1;
}

/**
 * The Projects Bank counts a member's «رصيد» inside one membership year, which the caller hands over as
 * `member_end` + `member_days`. An honorary member has no end date, so his year turns over every 365 days from the day
 * the membership was given: the balance renews like an annual member's, and the membership itself never ends.
 */
export function honoraryPeriod(since: string | null | undefined, now = Date.now()): { member_end: string; member_days: number } {
  const given = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? riyadhDayStart(since) : NaN;
  const start = Number.isFinite(given) && given <= now ? given : riyadhDayStart(`${riyadhDay(now).slice(0, 4)}-01-01`);
  const years = Math.floor((now - start) / (365 * DAY_MS));
  return { member_end: riyadhDay(start + (years + 1) * 365 * DAY_MS), member_days: 365 };
}

/** The membership period as the Projects Bank bridge wants it, honorary or paid. */
export function pbPeriodOf(account: { member_end: string; member_days: number; honorary?: 0 | 1 | null; honorary_since?: string | null }, now = Date.now()): { member_end: string; member_days: number } {
  return isHonorary(account) ? honoraryPeriod(account.honorary_since, now) : { member_end: account.member_end, member_days: account.member_days };
}
