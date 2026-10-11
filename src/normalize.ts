/**
 * Narration normalisation.
 *
 * Bank narrations carry a lot of noise that the books never reproduce:
 * channel prefixes, UTR numbers, trailing reference codes. Stripping that
 * noise is what makes two descriptions comparable at all.
 */

/** Channel prefixes Indian banks commonly stamp onto a narration. */
const CHANNEL_PREFIXES = [
  'UPI',
  'NEFT',
  'RTGS',
  'IMPS',
  'ACH',
  'ATM',
  'POS',
  'CHQ',
  'TFR',
];

/** Collapse whitespace, drop punctuation, upper-case. */
export function canonicalise(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove a leading channel marker such as "UPI/" or "NEFT-". */
export function stripChannelPrefix(description: string): string {
  const canonical = canonicalise(description);
  for (const prefix of CHANNEL_PREFIXES) {
    if (canonical.startsWith(prefix + ' ')) {
      return canonical.slice(prefix.length + 1);
    }
  }
  return canonical;
}

/**
 * Pull a bank reference out of a narration when one is embedded in it.
 * Matches runs of 10 or more digits, which is what UTRs and IMPS refs look like.
 */
export function extractReference(description: string): string | undefined {
  const match = description.match(/\b\d{10,}\b/);
  return match ? match[0] : undefined;
}

/** Full normalisation pipeline, used before any description comparison. */
export function normaliseDescription(description: string): string {
  return stripChannelPrefix(description);
}
