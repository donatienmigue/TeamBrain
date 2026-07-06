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

    const report = aggregateDigest({
      ...base,
      active: [{ id: 'M1', title: 'A', created: '2026-07-01' }],
      events: [authored],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('example.com');
    // The aggregate signal (retrieval) still lands.
    expect(report.topRetrieved).toEqual([{ id: 'M1', retrievals: 1 }]);
  });
});
