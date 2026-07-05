// M5.1 Shannon-entropy scanner. Catches opaque high-entropy tokens that the
// named secret rules miss (random base64 API secrets, session blobs). The
// token charset deliberately excludes '.', '/', ':' etc. so file paths, URLs,
// and dotted identifiers are never candidates — only compact opaque strings.

/** Minimum token length considered (M5.1: tokens ≥20 chars). */
export const ENTROPY_MIN_LENGTH = 20;
/** Bits-per-char threshold (M5.1: >4.5). */
export const ENTROPY_THRESHOLD = 4.5;

// Opaque-token charset: base64/base64url/hex-ish. No path or URL punctuation,
// so `src/components/Foo.tsx` and `https://…` are not tokens here.
const TOKEN_PATTERN = /[A-Za-z0-9+/=_-]{20,}/g;

/** Shannon entropy in bits per character over the string's symbol frequencies. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * True when `token` looks like an opaque high-entropy secret. Note that a
 * pure-hex token (≤16 distinct symbols) tops out at 4.0 bits/char, so git
 * SHAs and hex UUIDs never cross the 4.5 threshold — by construction, not by
 * a special case.
 */
export function isHighEntropyToken(token: string): boolean {
  return (
    token.length >= ENTROPY_MIN_LENGTH && shannonEntropy(token) > ENTROPY_THRESHOLD
  );
}

/** Replaces high-entropy tokens via `replace`, which returns the marker. */
export function redactHighEntropy(
  text: string,
  replace: () => string,
): string {
  return text.replace(TOKEN_PATTERN, (token) =>
    isHighEntropyToken(token) ? replace() : token,
  );
}
