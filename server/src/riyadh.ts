/** Riyadh days (UTC+3, no daylight saving): the hub and the dashboard count «today» and daily series in this zone. */
const OFFSET_MS = 3 * 3_600_000;
export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of the Riyadh day that contains this instant. */
export function riyadhDay(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant at which a Riyadh day starts. */
export function riyadhDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - OFFSET_MS;
}

/** The last `count` Riyadh days ending today, oldest first. */
export function lastRiyadhDays(count: number, now = Date.now()): string[] {
  const today = riyadhDayStart(riyadhDay(now));
  return Array.from({ length: count }, (_, index) => riyadhDay(today - (count - 1 - index) * DAY_MS));
}

/** The hub's time format: UTC `Y-m-d H:i:s`. */
export function hubTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Reads a hub time (UTC `Y-m-d H:i:s`) or an ISO string; NaN when it is neither. */
export function parseHubTime(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}
