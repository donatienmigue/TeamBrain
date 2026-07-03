import { randomBytes } from 'node:crypto';

// Crockford base32: excludes I, L, O, U.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const MAX_TIMESTAMP = 2 ** 48 - 1;

// First char is capped at 7: 10 base32 chars encode 50 bits but the
// timestamp is only 48 bits wide.
export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function encodeTime(timestamp: number): string {
  if (
    !Number.isInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > MAX_TIMESTAMP
  ) {
    throw new RangeError(
      `ULID timestamp must be an integer in [0, 2^48): got ${timestamp}`,
    );
  }
  let out = '';
  let rest = timestamp;
  for (let i = 0; i < TIME_CHARS; i++) {
    out = ENCODING.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(): string {
  // One random byte per char; & 0x1f is uniform because 256 is a multiple of 32.
  const bytes = randomBytes(RANDOM_CHARS);
  let out = '';
  for (const byte of bytes) {
    out += ENCODING.charAt(byte & 0x1f);
  }
  return out;
}

export function ulid(timestamp: number = Date.now()): string {
  return encodeTime(timestamp) + encodeRandom();
}

export function isUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}
