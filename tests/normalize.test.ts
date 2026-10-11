import {
  canonicalise,
  extractReference,
  normaliseDescription,
} from '../src/normalize';

describe('canonicalise', () => {
  it('upper-cases, drops punctuation and collapses whitespace', () => {
    expect(canonicalise('  Acme   Supplies,  Pvt. Ltd. ')).toBe('ACME SUPPLIES PVT LTD');
  });
});

describe('normaliseDescription', () => {
  it('strips a leading channel marker', () => {
    expect(normaliseDescription('UPI/ACME SUPPLIES')).toBe('ACME SUPPLIES');
    expect(normaliseDescription('NEFT-ACME SUPPLIES')).toBe('ACME SUPPLIES');
  });

  it('leaves a narration without a channel marker alone', () => {
    expect(normaliseDescription('ACME SUPPLIES')).toBe('ACME SUPPLIES');
  });

  it('does not strip a merchant whose name merely starts with a channel word', () => {
    expect(normaliseDescription('UPIGRADE LEARNING')).toBe('UPIGRADE LEARNING');
  });
});

describe('extractReference', () => {
  it('finds an embedded UTR', () => {
    expect(extractReference('NEFT/UTR 412345678901/ACME')).toBe('412345678901');
  });

  it('returns undefined when there is no long digit run', () => {
    expect(extractReference('ACME SUPPLIES')).toBeUndefined();
  });
});
