/**
 * The adviser's daily balance is shown only when it is nearly used up. A member should talk to the adviser freely
 * and never feel a counter running down; the number appears as a warning, not as a meter.
 */
const NEARLY_OUT = 0.1;

/** `left` of `limit` only when a tenth or less of the day's balance is still there. */
export function showAdvisorBalance(left: number | null | undefined, limit: number | null | undefined): left is number {
  if (left === null || left === undefined) return false;
  if (!limit || limit <= 0) return false;
  return left <= limit * NEARLY_OUT;
}
