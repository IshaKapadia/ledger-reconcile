import { equalAmounts, round2, sum, toMajorUnits, toMinorUnits } from '../src/money';

describe('toMinorUnits', () => {
  it('converts rupees to paise', () => {
    expect(toMinorUnits(1234.56)).toBe(123456);
    expect(toMinorUnits(0)).toBe(0);
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
});
