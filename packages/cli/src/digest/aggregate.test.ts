import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import {
  aggregateDigest,
  toAggregateEvent,
  type DigestInput,
} from './aggregate.js';

function ev(evName: SessionEvent['ev'], data: object): SessionEvent {
  return {
    v: 1,
    sid: 'sess-x',
    t: '2026-07-01T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/web',
    branch: 'main',
    ev: evName,
    data,
  } as SessionEvent;
}

const base: Omit<DigestInput, 'events'> = {
  active: [],
  retiredCount: 0,
  proposedCount: 0,
  rules: [],
  now: new Date('2026-07-06T00:00:00Z'),
};

describe('aggregateDigest (M7.1)', () => {
  it('counts memories, top-retrieved, and no-hit searches', () => {
    const report = aggregateDigest({
      ...base,
      proposedCount: 2,
      retiredCount: 1,
      active: [
        { id: 'M1', title: 'A', created: '2026-07-01' },
        { id: 'M2', title: 'B', created: '2026-07-01' },
      ],
      events: [
        ev('memory_retrieved', { ids: ['M1', 'M2'] }),
        ev('memory_retrieved', { ids: ['M1'] }),
        ev('memory_retrieved', { ids: [] }),
        ev('memory_retrieved', { ids: [] }),
      ],
    });
    expect(report.memories).toEqual({ proposed: 2, approved: 2, retired: 1 });
    expect(report.topRetrieved).toEqual([
      { id: 'M1', retrievals: 2 },
      { id: 'M2', retrievals: 1 },
    ]);
    expect(report.noHitSearches).toBe(2);
  });

  it('flags stale memories (≥90d old, never retrieved in the window)', () => {
    const report = aggregateDigest({
      ...base,
      active: [
        { id: 'OLD', title: 'Ancient', created: '2026-01-01' }, // >90d, no retrieval
        { id: 'OLDBUTUSED', title: 'Used', created: '2026-01-01' }, // >90d but retrieved
        { id: 'FRESH', title: 'New', created: '2026-07-01' }, // <90d
      ],
      events: [ev('memory_retrieved', { ids: ['OLDBUTUSED'] })],
    });
    expect(report.stale.map((s) => s.id)).toEqual(['OLD']);
  });

  it('injection events (via:context) do not count as query retrievals', () => {
    const report = aggregateDigest({
      ...base,
      active: [{ id: 'M1', title: 'A', created: '2026-07-01' }],
      events: [
        // A session-start injection of M1 — must NOT inflate topRetrieved or
        // be read as a no-hit search; it feeds the rot metrics instead.
        ev('memory_retrieved', {
          ids: ['M1'],
          via: 'context',
          tokens: 800,
          required: 1,
          required_tokens: 200,
        }),
      ],
    });
    expect(report.topRetrieved).toEqual([]);
    expect(report.noHitSearches).toBe(0);
    // …but the context metrics saw it.
    expect(report.contextMetrics.sessionsWithInjection).toBe(1);
    expect(report.contextMetrics.injectionWeight.median).toBe(800);
  });

  it('net-efficiency composite: insufficient data until the holdout is measured', () => {
    // A handful of arm-tagged sessions (<20/arm) → estimated → insufficient.
    const events: SessionEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(
        ev('memory_retrieved', { via: 'context', ids: ['M1'], tokens: 800, required: 1, required_tokens: 200 }),
      );
    }
    const report = aggregateDigest({
      ...base,
      active: [{ id: 'M1', title: 'A', created: '2026-07-01' }],
      events: [
        ...events,
        { ...ev('session_start', { codemap_arm: 'treatment' }), sid: 't1' } as SessionEvent,
      ],
    });
    expect(report.netEfficiency.verdict).toBe('insufficient-data');
    expect(report.netEfficiency.injectionWeightTokens).toBe(800);
  });

  it('net-efficiency composite: measured ≥30% reduction with CI excluding zero → net-anti-rot', () => {
    // Build ≥20 sessions/arm: control explores ~10, treatment ~3, each with a
    // session-start injection so the weight term is populated.
    const events: SessionEvent[] = [];
    const mk = (arm: 'control' | 'treatment', i: number, explores: number): void => {
      const sid = `${arm}-${i}`;
      events.push({ ...ev('session_start', { codemap_arm: arm }), sid } as SessionEvent);
      events.push({
        ...ev('memory_retrieved', { via: 'context', ids: ['M1'], tokens: 700, required: 1, required_tokens: 200 }),
        sid,
      } as SessionEvent);
      for (let j = 0; j < explores; j += 1) {
        events.push({ ...ev('tool_use', { kind: 'explore' }), sid } as SessionEvent);
      }
    };
    for (let i = 0; i < 22; i += 1) mk('control', i, 10 + (i % 3));
    for (let i = 0; i < 22; i += 1) mk('treatment', i, 3 + (i % 2));

    const ne = aggregateDigest({
      ...base,
      active: [{ id: 'M1', title: 'A', created: '2026-07-01' }],
      events,
    }).netEfficiency;
    expect(ne.label).toBe('measured');
    expect(ne.explorationReductionPct as number).toBeGreaterThanOrEqual(30);
    expect((ne.reductionCi95 as [number, number])[0]).toBeGreaterThan(0);
    expect(ne.injectionWeightTokens).toBe(700);
    expect(ne.verdict).toBe('net-anti-rot');
  });

  it('reports rules drift vs the baseline', () => {
    const report = aggregateDigest({
      ...base,
      events: [],
      rules: [
        { file: 'CLAUDE.md', hash: 'new', baselineHash: 'old' },
        { file: '.cursorrules', hash: 'same', baselineHash: 'same' },
        { file: 'AGENTS.md', hash: 'x', baselineHash: null },
      ],
    });
    expect(report.drift).toEqual([
      { file: '.cursorrules', hash: 'same', changed: false },
      { file: 'AGENTS.md', hash: 'x', changed: false },
      { file: 'CLAUDE.md', hash: 'new', changed: true },
    ]);
  });

  // Structural privacy guarantee (M7.1 guardrail): the projection strips every
  // identity-bearing field, so no per-person data can reach the output even if
  // events arrive carrying an author.
  it('never emits per-person data, even from authored events', () => {
    const authored = {
      ...ev('memory_retrieved', { ids: ['M1'] }),
      author: 'alice@example.com',
      user: 'alice',
    } as unknown as SessionEvent;

    // The projection itself drops the identity fields.
    expect(toAggregateEvent(authored)).toEqual({
      ev: 'memory_retrieved',
      data: { ids: ['M1'] },
    });

    // An authored injection event too — the rot metrics must stay people-free.
    const authoredInjection = {
      ...ev('memory_retrieved', {
        ids: ['M1'],
        via: 'context',
        tokens: 900,
        required: 1,
        required_tokens: 300,
      }),
      author: 'bob@example.com',
    } as unknown as SessionEvent;

    const report = aggregateDigest({
      ...base,
      active: [{ id: 'M1', title: 'A', created: '2026-07-01' }],
      events: [authored, authoredInjection],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('bob');
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain('sess-x'); // no sid survives
    // The aggregate signal (retrieval) still lands.
    expect(report.topRetrieved).toEqual([{ id: 'M1', retrievals: 1 }]);
    // …and so does the rot metric, people-free.
    expect(report.contextMetrics.injectionWeight.median).toBe(900);
  });
});
