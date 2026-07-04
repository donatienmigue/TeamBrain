import { describe, expect, it } from 'vitest';
import {
  applyTokenBudget,
  estimateTokens,
  isExpired,
  rrfFuse,
  toFtsMatchExpression,
} from './search-pipeline.js';
import type { Scored } from './types.js';

describe('toFtsMatchExpression', () => {
  it('quotes and OR-joins bare terms', () => {
    expect(toFtsMatchExpression('redis rate limiting')).toBe(
      '"redis" OR "rate" OR "limiting"',
    );
  });

  it('neutralizes FTS5 operators and column syntax', () => {
    expect(toFtsMatchExpression('title:x AND (y OR z) NOT "a"*')).toBe(
      '"title" OR "x" OR "and" OR "y" OR "or" OR "z" OR "not" OR "a"',
    );
  });

  it('returns null when no indexable term remains', () => {
    expect(toFtsMatchExpression('*** !!! ---')).toBeNull();
    expect(toFtsMatchExpression('')).toBeNull();
  });
});

describe('rrfFuse', () => {
  it('scores 1/(k+rank) summed across lists', () => {
    const fused = rrfFuse([
      [1, 2],
      [2, 3],
    ]);
    expect(fused.get(1)).toBeCloseTo(1 / 61);
    expect(fused.get(2)).toBeCloseTo(1 / 62 + 1 / 61);
    expect(fused.get(3)).toBeCloseTo(1 / 62);
  });

  it('ranks a doc present in both lists above single-list docs', () => {
    const fused = rrfFuse([
      [1, 2, 3],
      [3, 4, 5],
    ]);
    const byScore = [...fused.entries()].sort((a, b) => b[1] - a[1]);
    expect(byScore[0]?.[0]).toBe(3);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-07-04T12:00:00Z');

  it('null/undefined TTL never expires', () => {
    expect(isExpired('2020-01-01', null, now)).toBe(false);
    expect(isExpired('2020-01-01', undefined, now)).toBe(false);
    expect(isExpired(undefined, 30, now)).toBe(false);
  });

  it('created + ttl_days in the past is expired', () => {
    expect(isExpired('2026-06-01', 30, now)).toBe(true);
    expect(isExpired('2026-07-01', 30, now)).toBe(false);
  });
});

function doc(
  id: string,
  priority: Scored['priority'],
  bodyChars: number,
): Scored {
  return {
    id,
    source: 'memory',
    title: '',
    body: 'x'.repeat(bodyChars),
    priority,
    tags: [],
    score: 0,
  };
}

describe('applyTokenBudget', () => {
  it('estimates 4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('drops lowest-ranked advisory docs until the budget fits', () => {
    const docs = [
      doc('a', 'advisory', 400), // 100 tokens
      doc('b', 'advisory', 400),
      doc('c', 'advisory', 400),
    ];
    const kept = applyTokenBudget(docs, 200);
    expect(kept.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('never drops required docs, even over budget', () => {
    const docs = [
      doc('r1', 'required', 400),
      doc('a', 'advisory', 400),
      doc('r2', 'required', 400),
    ];
    const kept = applyTokenBudget(docs, 100);
    expect(kept.map((d) => d.id)).toEqual(['r1', 'r2']);
  });

  it('keeps everything when the budget fits', () => {
    const docs = [doc('a', 'advisory', 40), doc('b', 'advisory', 40)];
    expect(applyTokenBudget(docs, 1000)).toHaveLength(2);
  });
});
