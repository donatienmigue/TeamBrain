import { describe, expect, it } from 'vitest';
import {
  redactString,
  redactValue,
  summarizeReplacements,
} from './engine.js';
import { shannonEntropy, isHighEntropyToken } from './entropy.js';
import { buildDenyMatcher } from './globs.js';

describe('redactString — secrets', () => {
  it('redacts an AWS access key with its type', () => {
    const { text, replacements } = redactString('key AKIAIOSFODNN7EXAMPLE end');
    expect(text).toBe('key «REDACTED:aws_access_key» end');
    expect(replacements).toEqual(['aws_access_key']);
  });

  it('redacts a GitHub token', () => {
    const { text } = redactString('ghp_abcdef0123456789abcdef0123456789abcd');
    expect(text).toBe('«REDACTED:github_token»');
  });

  it('redacts an armored private key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END RSA PRIVATE KEY-----';
    expect(redactString(`x ${pem} y`).text).toBe('x «REDACTED:private_key» y');
  });

  it('redacts an assignment-style generic secret but not prose', () => {
    expect(redactString('password = hunter2superLongValue').text).toContain(
      '«REDACTED:generic_secret»',
    );
    expect(redactString('the auth token expired last night').replacements).toEqual(
      [],
    );
  });
});

describe('redactString — high entropy', () => {
  it('redacts a random base64 blob', () => {
    const blob = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE0=';
    expect(redactString(blob).text).toBe('«REDACTED:high_entropy»');
  });

  it('never redacts a git SHA or hex UUID (hex tops out at 4 bits/char)', () => {
    const sha = '9fceb02d0ae598e95dc970b74767f19372d61af8';
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(redactString(sha).replacements).toEqual([]);
    expect(redactString(uuid).replacements).toEqual([]);
    expect(isHighEntropyToken(sha)).toBe(false);
  });

  it('never treats a file path as a token', () => {
    const path = 'src/components/user/UserProfileSettingsPanel.tsx';
    expect(redactString(path).replacements).toEqual([]);
  });
});

describe('redactString — PII and levels', () => {
  it('redacts email/ip/phone at strict level', () => {
    expect(redactString('mail a@b.com from 10.0.0.1').text).toBe(
      'mail «REDACTED:email» from «REDACTED:ip»',
    );
    expect(redactString('call 555-123-4567').text).toBe(
      'call «REDACTED:phone»',
    );
  });

  it('keeps PII at standard level but still scrubs secrets', () => {
    const input = 'a@b.com AKIAIOSFODNN7EXAMPLE';
    const { text } = redactString(input, 'standard');
    expect(text).toBe('a@b.com «REDACTED:aws_access_key»');
  });
});

describe('shannonEntropy', () => {
  it('is 0 for a single repeated char and ~1 for two equal symbols', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abab')).toBeCloseTo(1, 5);
  });
});

describe('redactValue (deep)', () => {
  it('scrubs string leaves and keeps object keys, aggregating replacements', () => {
    const { value, replacements } = redactValue({
      summary: 'token = superSecretValue123',
      nested: { email: 'x@y.io' },
      count: 3,
    });
    expect((value as { count: number }).count).toBe(3);
    expect(JSON.stringify(value)).toContain('«REDACTED:generic_secret»');
    expect(JSON.stringify(value)).toContain('«REDACTED:email»');
    expect(summarizeReplacements(replacements)).toEqual({
      generic_secret: 1,
      email: 1,
    });
  });
});

describe('buildDenyMatcher', () => {
  it('matches gitignore-style patterns with negation', () => {
    const matcher = buildDenyMatcher([
      '*.env',
      'secrets/',
      '# comment',
      'build/**',
      '!build/keep.txt',
    ]);
    expect(matcher.denies('config/prod.env')).toBe(true);
    expect(matcher.denies('secrets/aws.json')).toBe(true);
    expect(matcher.denies('build/output/app.js')).toBe(true);
    expect(matcher.denies('build/keep.txt')).toBe(false);
    expect(matcher.denies('src/index.ts')).toBe(false);
  });
});
