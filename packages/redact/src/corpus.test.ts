import { describe, expect, it } from 'vitest';
import { redactString } from './engine.js';
import { loadRedactionCorpus } from './corpus.js';

// M5.1 release gate: the public corpus. CI fails on any regression here — a
// false negative (secret leaks) or a false positive (a git SHA / UUID / path
// gets redacted) is a shipping blocker, not a warning. The loader (with its
// de-fang/refang handling) is shared with `tb verify` V4 so the repo test and
// the installed-binary verifier can never diverge.

const corpus = loadRedactionCorpus();

describe('redaction corpus (M5.1 release gate)', () => {
  it('has at least 120 cases across positives and negatives', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(120);
    expect(corpus.some((c) => c.kind === 'positive')).toBe(true);
    expect(corpus.some((c) => c.kind === 'negative')).toBe(true);
  });

  it('covers every detector type with at least one positive', () => {
    const detectors = new Set(corpus.flatMap((c) => c.expect_types ?? []));
    for (const required of [
      'aws_access_key',
      'github_token',
      'gitlab_token',
      'slack_token',
      'google_api_key',
      'stripe_key',
      'anthropic_key',
      'openai_key',
      'npm_token',
      'jwt',
      'connection_string',
      'generic_secret',
      'private_key',
      'high_entropy',
      'email',
      'ip',
      'phone',
    ]) {
      expect(detectors.has(required)).toBe(true);
    }
  });

  for (const testCase of corpus) {
    it(`${testCase.id}: ${testCase.kind}${testCase.note ? ` (${testCase.note})` : ''}`, () => {
      const { text, replacements } = redactString(testCase.input, 'strict');
      if (testCase.kind === 'positive') {
        for (const type of testCase.expect_types ?? []) {
          expect(replacements).toContain(type);
        }
        if (testCase.secret !== undefined) {
          expect(text).not.toContain(testCase.secret);
        }
      } else {
        // A negative must pass through untouched — no false positives.
        expect(replacements).toEqual([]);
        expect(text).toBe(testCase.input);
      }
    });
  }
});
