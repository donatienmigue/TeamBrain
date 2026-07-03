import { describe, expect, it } from 'vitest';
import { isUlid, ulid, ULID_REGEX } from './ulid.js';

describe('ulid', () => {
  it('produces 26 Crockford base32 chars matching the ULID shape', () => {
    for (let i = 0; i < 100; i++) {
      expect(ulid()).toMatch(ULID_REGEX);
    }
  });

  it('is lexicographically ordered by timestamp', () => {
    const earlier = ulid(1_000_000_000_000);
    const later = ulid(2_000_000_000_000);
    expect(earlier < later).toBe(true);
    // Same-timestamp ids share the 10-char time prefix.
    expect(ulid(1234567890).slice(0, 10)).toBe(ulid(1234567890).slice(0, 10));
  });

  it('encodes the zero and max timestamps without corruption', () => {
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ');
  });

  it('rejects out-of-range timestamps', () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(2 ** 48)).toThrow(RangeError);
    expect(() => ulid(1.5)).toThrow(RangeError);
  });

  it('does not collide across 10k generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(ulid());
    }
    expect(seen.size).toBe(10_000);
  });
});

describe('isUlid', () => {
  it('accepts generated ids', () => {
    expect(isUlid(ulid())).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('01J8YAV2C3D4E5F6G7H8J9K0M')).toBe(false); // 25 chars
    expect(isUlid('01J8YAV2C3D4E5F6G7H8J9K0M12')).toBe(false); // 27 chars
    expect(isUlid('81J8YAV2C3D4E5F6G7H8J9K0M1')).toBe(false); // first char > 7
    expect(isUlid('01J8YAV2C3D4E5F6G7H8J9K0MI')).toBe(false); // I not in alphabet
    expect(isUlid('01j8yav2c3d4e5f6g7h8j9k0m1')).toBe(false); // lowercase
  });
});
