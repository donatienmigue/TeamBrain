import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { computeContextMetrics } from './context-metrics.js';

// Performance-metrics brief §3.1: the context-efficiency & rot metrics.
// People-free by construction — the negative test at the bottom asserts no
// identity field survives.

function ev(
  sid: string,
  minute: number,
  body: { ev: SessionEvent['ev']; data: unknown },
): SessionEvent {
  return {
    v: 1,
    sid,
    t: `2026-07-06T12:${String(minute).padStart(2, '0')}:00.000Z`,
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev: body.ev,
    data: body.data,
  } as SessionEvent;
}

function injection(sid: string, data: object): SessionEvent {
  return ev(sid, 0, { ev: 'memory_retrieved', data: { via: 'context', ...data } });
}

const NOW = new Date('2026-07-06T00:00:00Z');

describe('computeContextMetrics (§3.1)', () => {
  it('injection weight distribution over sessions', () => {
    const m = computeContextMetrics(
      [
        injection('s1', { ids: ['M1'], tokens: 600, required: 1, required_tokens: 200 }),
        injection('s2', { ids: ['M1'], tokens: 1000, required: 1, required_tokens: 200 }),
      ],
      { active: [], staleDays: 90, now: NOW },
    );
    expect(m.sessionsWithInjection).toBe(2);
    expect(m.injectionWeight.median).toBe(800);
    expect(m.injectionWeight.max).toBe(1000);
  });

  it('required-load flags when it exceeds the token budget', () => {
    const under = computeContextMetrics(
      [injection('s1', { ids: ['R1'], tokens: 500, required: 2, required_tokens: 400 })],
      { active: [], staleDays: 90, now: NOW, requiredBudget: 1000 },
    );
    expect(under.requiredLoad).toEqual({
      count: 2,
      tokens: 400,
      budget: 1000,
      overBudget: false,
    });
    const over = computeContextMetrics(
      [injection('s1', { ids: ['R1'], tokens: 2000, required: 9, required_tokens: 1500 })],
      { active: [], staleDays: 90, now: NOW, requiredBudget: 1000 },
    );
    expect(over.requiredLoad.overBudget).toBe(true);
  });

  it('codemap utilization: injected map entries whose path is later touched', () => {
    const m = computeContextMetrics(
      [
        injection('s1', {
          ids: ['cm:src/a.ts', 'cm:src/b.ts'],
          tokens: 400,
          required: 0,
          required_tokens: 0,
        }),
        // a.ts is touched later; b.ts is not.
        ev('s1', 1, { ev: 'tool_use', data: { kind: 'edit', path: 'src/a.ts' } }),
      ],
      { active: [], staleDays: 90, now: NOW },
    );
    expect(m.utilization.codemapInjected).toBe(2);
    expect(m.utilization.codemapReferenced).toBe(1);
    expect(m.utilization.rate).toBe(0.5);
  });

  it('utilization rate is null when no codemap was injected (not fabricated)', () => {
    const m = computeContextMetrics(
      [injection('s1', { ids: ['M1'], tokens: 300, required: 0, required_tokens: 0 })],
      { active: [], staleDays: 90, now: NOW },
    );
    expect(m.utilization.rate).toBeNull();
  });

  it('served staleness: injected memories ≥staleDays old count as served rot', () => {
    const m = computeContextMetrics(
      [
        injection('s1', {
          ids: ['OLD', 'FRESH'],
          tokens: 500,
          required: 0,
          required_tokens: 0,
        }),
      ],
      {
        active: [
          { id: 'OLD', title: 'Ancient', created: '2026-01-01' }, // >90d
          { id: 'FRESH', title: 'New', created: '2026-07-01' }, // <90d
        ],
        staleDays: 90,
        now: NOW,
      },
    );
    expect(m.servedStaleness.served).toBe(2);
    expect(m.servedStaleness.stale).toBe(1);
    expect(m.servedStaleness.rate).toBe(0.5);
  });

  it('negative: no injections → zeroed, nulls, never NaN', () => {
    const m = computeContextMetrics(
      [ev('s1', 0, { ev: 'tool_use', data: { kind: 'edit', path: 'x.ts' } })],
      { active: [], staleDays: 90, now: NOW },
    );
    expect(m.sessionsWithInjection).toBe(0);
    expect(m.injectionWeight).toEqual({ median: 0, mean: 0, max: 0 });
    expect(m.utilization.rate).toBeNull();
    expect(m.servedStaleness.rate).toBeNull();
  });

  it('negative: output carries no per-person / identity fields', () => {
    const serialized = JSON.stringify(
      computeContextMetrics(
        [
          injection('secret-sid', {
            ids: ['cm:src/a.ts', 'M1'],
            tokens: 700,
            required: 1,
            required_tokens: 200,
          }),
          ev('secret-sid', 1, {
            ev: 'tool_use',
            data: { kind: 'edit', path: 'src/a.ts' },
          }),
        ],
        { active: [{ id: 'M1', title: 'A', created: '2026-01-01' }], staleDays: 90, now: NOW },
      ),
    );
    for (const forbidden of ['secret-sid', 'claude-code', 'acme/api', '"sid"', 'src/a.ts', 'M1']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
