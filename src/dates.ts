/** Date helpers. All dates in this library are ISO-8601 date strings (YYYY-MM-DD). */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

/** Parse an ISO date string to a UTC timestamp, so no local timezone creeps in. */
export function toUtcTimestamp(iso: string): number {
  if (!isIsoDate(iso)) {
    throw new Error(`Expected an ISO date (YYYY-MM-DD), received "${iso}"`);
  }
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates, always non-negative. */
export function daysBetween(a: string, b: string): number {
  return Math.abs(toUtcTimestamp(a) - toUtcTimestamp(b)) / MS_PER_DAY;
}

/** True when two dates are within `toleranceDays` of each other. */
export function withinDays(a: string, b: string, toleranceDays: number): boolean {
  return daysBetween(a, b) <= toleranceDays;
}
