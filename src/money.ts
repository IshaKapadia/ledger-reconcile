/**
 * Money helpers.
 *
 * Amounts throughout the library are plain numbers in major units
 * (so 1234.56 means one thousand two hundred thirty four rupees, fifty six paise).
 */

/** Round to 2 decimal places. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Add a list of amounts together. */
export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}

/** True when two amounts represent the same sum of money. */
export function equalAmounts(a: number, b: number): boolean {
  return a === b;
}

/** Format an amount for display, in Indian digit grouping. */
export function formatAmount(value: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}
