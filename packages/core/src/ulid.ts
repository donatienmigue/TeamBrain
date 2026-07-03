import { randomBytes } from 'node:crypto';

// Crockford base32: excludes I, L, O, U.
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHAR_COUNT = 10;
const RANDOM_CHAR_COUNT = 16;
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

// First char is capped at 7: 10 base32 chars encode 50 bits but the
// timestamp is only 48 bits wide.
export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function encodeTimestamp(timestampMs: number): string {
  if (
    !Number.isInteger(timestampMs) ||
    timestampMs < 0 ||
    timestampMs > MAX_TIMESTAMP_MS
  ) {
    throw new RangeError(
      `ULID timestamp must be an integer in [0, 2^48): got ${timestampMs}`,
    );
  }
  let encoded = '';
  let remaining = timestampMs;
  for (let i = 0; i < TIME_CHAR_COUNT; i++) {
    encoded = CROCKFORD_BASE32_ALPHABET.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function encodeRandomness(): string {
  // One random byte per char; & 0x1f is uniform because 256 is a multiple of 32.
  const bytes = randomBytes(RANDOM_CHAR_COUNT);
  let encoded = '';
  for (const byte of bytes) {
    encoded += CROCKFORD_BASE32_ALPHABET.charAt(byte & 0x1f);
  }
  return encoded;
}

export function ulid(timestampMs: number = Date.now()): string {
  return encodeTimestamp(timestampMs) + encodeRandomness();
}

export function isUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}
