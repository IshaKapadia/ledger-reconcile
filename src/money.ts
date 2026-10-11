/**
 * Money helpers.
 *
 * Amounts cross the library boundary as plain numbers in major units
 * (1234.56 means one thousand two hundred thirty four rupees, fifty six paise),
 * because that is what callers have after parsing a statement.
 *
 * Internally we work in minor units (paise) held as integers. Binary floating
 * point cannot represent 0.1, so comparing two amounts with `===` after any
 * arithmetic will eventually say two equal sums of money are different. In
 * reconciliation that shows up as a line that refuses to match for no reason
 * the user can see.
 */

/** Smallest unit per major unit. 100 paise to the rupee. */
const MINOR_UNITS_PER_MAJOR = 100;

/** Convert major units to integer minor units. */
export function toMinorUnits(value: number): number {
  return Math.trunc(value * MINOR_UNITS_PER_MAJOR);
}

/** Convert integer minor units back to major units. */
export function toMajorUnits(minor: number): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/** Round to 2 decimal places. */
export function round2(value: number): number {
  return toMajorUnits(toMinorUnits(value));
}

/** Add a list of amounts together, accumulating in minor units. */
export function sum(values: number[]): number {
  let totalMinor = 0;
  for (const v of values) {
    totalMinor += toMinorUnits(v);
  }
  return toMajorUnits(totalMinor);
}

/**
 * True when two amounts represent the same sum of money.
 * Compared in minor units so float representation cannot separate them.
 */
export function equalAmounts(a: number, b: number): boolean {
  return Math.abs(toMinorUnits(a) - toMinorUnits(b)) <= 0;
}

/** Format an amount for display, in Indian digit grouping. */
export function formatAmount(value: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

/** Format a minor-unit amount for display. */
export function formatMinorUnits(minor: number, currency = 'INR'): string {
  return formatAmount(minor, currency);
}
