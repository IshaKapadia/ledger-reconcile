import {
  equalAmounts,
  formatMinorUnits,
  round2,
  sum,
  toMajorUnits,
  toMinorUnits,
} from '../src/money';

describe('toMinorUnits', () => {
  it('converts rupees to paise', () => {
    expect(toMinorUnits(1234.56)).toBe(123456);
    expect(toMinorUnits(0)).toBe(0);
  });

  // Each of these multiplies to just *under* the integer in binary floating
  // point, so truncating would quietly lose a paisa. 0.29 * 100 is
  // 28.999999999999996 and 1.15 * 100 is 114.99999999999999.
  it('does not lose a paisa on values whose float product falls short', () => {
    expect(toMinorUnits(0.29)).toBe(29);
    expect(toMinorUnits(1.15)).toBe(115);
    expect(toMinorUnits(8.29)).toBe(829);
  });

  // 1.005 * 100 is 100.49999999999999, which rounds down unless the
  // representation error is cleared first.
  it('rounds a genuine half up rather than down', () => {
    expect(toMinorUnits(1.005)).toBe(101);
  });

  it('treats a refund the same distance as the equivalent charge', () => {
    expect(toMinorUnits(-0.29)).toBe(-29);
    expect(toMinorUnits(-8.295)).toBe(-830);
    expect(toMinorUnits(8.295)).toBe(830);
  });
});

describe('toMajorUnits', () => {
  it('round-trips through minor units', () => {
    expect(toMajorUnits(toMinorUnits(99.99))).toBe(99.99);
  });
});

describe('equalAmounts', () => {
  it('treats two equal sums as equal', () => {
    expect(equalAmounts(1500, 1500)).toBe(true);
  });

  it('survives float drift that would defeat a === comparison', () => {
    const drifted = 0.1 + 0.2; // 0.30000000000000004
    expect(drifted === 0.3).toBe(false);
    expect(equalAmounts(drifted, 0.3)).toBe(true);
  });

  it('still separates genuinely different amounts', () => {
    expect(equalAmounts(1500, 1500.01)).toBe(false);
  });

  // Truncating both sides collapsed these onto the same paise value, so a
  // statement line would reconcile against a ledger entry a paisa out.
  it('separates amounts that differ by a single paisa', () => {
    expect(equalAmounts(0.29, 0.28)).toBe(false);
    expect(equalAmounts(1500.009, 1500.0)).toBe(false);
  });
});

describe('sum', () => {
  it('accumulates without float drift', () => {
    expect(sum([0.1, 0.2])).toBe(0.3);
    expect(sum([1500, 250.5, 99.5])).toBe(1850);
  });

  it('returns zero for an empty list', () => {
    expect(sum([])).toBe(0);
  });
});

describe('round2', () => {
  it('keeps two decimal places', () => {
    expect(round2(1234.5612)).toBe(1234.56);
  });

  // 1234.5612 rounds and truncates to the same value, so on its own it cannot
  // tell the two apart. These can.
  it('rounds up rather than truncating', () => {
    expect(round2(1234.5698)).toBe(1234.57);
    expect(round2(2.999)).toBe(3);
    expect(round2(0.29)).toBe(0.29);
  });
});

describe('formatMinorUnits', () => {
  it('formats paise as the major-unit amount', () => {
    // 12345 paise is ₹123.45, not ₹12,345.00.
    expect(formatMinorUnits(12345)).toContain('123.45');
  });
});
