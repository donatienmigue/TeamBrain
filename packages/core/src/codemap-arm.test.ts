import { describe, expect, it } from 'vitest';
import { codemapArm, effectiveHoldout, fnv1a } from './codemap-arm.js';
import { parseBrainConfig } from './brain-config.js';

// R16.1 T7a: the holdout arm assignment must be a deterministic pure function
// of the session id — the SAME sid always lands in the SAME arm, in every
// process, or the treatment/control arms disagree and the measurement is
// biased. These tests pin determinism, the distribution, and the
// disabled-is-control equivalence.

describe('R16.1 T7a: codemap holdout arm assignment', () => {
  it('fnv1a is stable and 32-bit', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    for (const s of ['', 'a', 'session-01', 'x'.repeat(64)]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('is deterministic: same sid → same arm, always', () => {
    for (let i = 0; i < 500; i += 1) {
      const sid = `sid-${i}`;
      const first = codemapArm(sid, 0.1);
      expect(codemapArm(sid, 0.1)).toBe(first);
      expect(codemapArm(sid, 0.1)).toBe(first);
    }
  });

  it('holdout ≤ 0 → always treatment; ≥ 1 → always control', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(codemapArm(`s${i}`, 0)).toBe('treatment');
      expect(codemapArm(`s${i}`, -0.5)).toBe('treatment');
      expect(codemapArm(`s${i}`, Number.NaN)).toBe('treatment');
      expect(codemapArm(`s${i}`, 1)).toBe('control');
      expect(codemapArm(`s${i}`, 2)).toBe('control');
    }
  });

  it('distributes ≈ holdout fraction over 10k synthetic sids (±2pp)', () => {
    const n = 10_000;
    let control = 0;
    for (let i = 0; i < n; i += 1) {
      if (codemapArm(`session-${i}`, 0.1) === 'control') control += 1;
    }
    const fraction = control / n;
    expect(Math.abs(fraction - 0.1)).toBeLessThanOrEqual(0.02);
  });

  it('effectiveHoldout: disabled codemap → 0 (every session behaves as control-equivalent)', () => {
    expect(effectiveHoldout({ enabled: false, holdout: 0.1 })).toBe(0);
    expect(effectiveHoldout({ enabled: false })).toBe(0);
    // When disabled the arm tag is meaningless-but-harmless: treatment for all.
    for (let i = 0; i < 50; i += 1) {
      expect(codemapArm(`s${i}`, effectiveHoldout({ enabled: false }))).toBe(
        'treatment',
      );
    }
  });

  it('effectiveHoldout: enabled codemap passes the configured holdout through', () => {
    expect(effectiveHoldout({ enabled: true, holdout: 0.25 })).toBe(0.25);
    expect(effectiveHoldout({ enabled: true })).toBe(0);
  });

  it('brain.yaml codemap.holdout defaults to 0.1 and is bounded 0–1', () => {
    expect(parseBrainConfig('version: 1\n').codemap.holdout).toBe(0.1);
    expect(
      parseBrainConfig('version: 1\ncodemap:\n  holdout: 0\n').codemap.holdout,
    ).toBe(0);
    expect(() =>
      parseBrainConfig('version: 1\ncodemap:\n  holdout: 1.5\n'),
    ).toThrow();
  });
});
