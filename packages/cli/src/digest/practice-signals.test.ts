import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { computePracticeSignals } from './practice-signals.js';

// D3.2/D3.3 acceptance: the FlightDeck signal aggregates computed from
// metadata-only events, plus the structural privacy negative test (no
// identity-bearing event field survives into the output).

const SID_A = '01JZTESTAAAAAAAAAAAAAAAAAA';
const SID_B = '01JZTESTBBBBBBBBBBBBBBBBBB';
const SID_C = '01JZTESTCCCCCCCCCCCCCCCCCC';

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
    model: 'claude-fable-5',
    repo: 'acme/api',
    branch: 'main',
    ev: body.ev,
    data: body.data,
  } as SessionEvent;
}

/**
 * Session A: retrieves memories, one failed test then a retry that passes,
 * one plan revision, commits. Session B: never retrieves, two failed
 * commands with a retry, abandoned. Session C: starts and retrieves but
 * never ends (idle Cursor-style session without session_end).
 */
function fixture(): SessionEvent[] {
  return [
    ev(SID_A, 0, { ev: 'session_start', data: {} }),
    ev(SID_A, 1, { ev: 'memory_retrieved', data: { ids: ['01JZMEM1'] } }),
    ev(SID_A, 2, { ev: 'tool_use', data: { kind: 'edit', path: 'src/a.ts' } }),
    ev(SID_A, 3, { ev: 'tool_use', data: { kind: 'test', exit_code: 1 } }),
    ev(SID_A, 4, { ev: 'plan_revision', data: {} }),
    ev(SID_A, 5, { ev: 'tool_use', data: { kind: 'test', exit_code: 0 } }),
    ev(SID_A, 6, {
      ev: 'session_end',
      data: {
        outcome: 'committed',
        duration_s: 360,
        turns: 6,
        commit_shas: ['abc1234'],
      },
    }),

    ev(SID_B, 0, { ev: 'session_start', data: {} }),
    ev(SID_B, 1, { ev: 'memory_retrieved', data: { ids: [] } }),
    ev(SID_B, 2, { ev: 'tool_use', data: { kind: 'command', exit_code: 2 } }),
    ev(SID_B, 3, { ev: 'tool_use', data: { kind: 'command', exit_code: 2 } }),
    ev(SID_B, 4, {
      ev: 'session_end',
      data: {
        outcome: 'abandoned',
        duration_s: 240,
        turns: 4,
        commit_shas: [],
      },
    }),

    ev(SID_C, 0, { ev: 'session_start', data: {} }),
    ev(SID_C, 1, { ev: 'memory_retrieved', data: { ids: ['01JZMEM2'] } }),
  ];
}

describe('computePracticeSignals (D3.2/D3.3)', () => {
  it('computes session counts, outcome mix, and per-session distributions', () => {
    const signals = computePracticeSignals(fixture());

    expect(signals.sessions).toBe(3);
    expect(signals.ended).toBe(2);
    expect(signals.outcomes).toEqual({
      committed: 1,
      abandoned: 1,
      unknown: 0,
    });
    // A: failed test → test again = 1 retry; B: failed command → command = 1.
    expect(signals.retries).toEqual({ median: 1, mean: 0.67, max: 1 });
    expect(signals.failedCommands.max).toBe(2);
    expect(signals.planRevisions).toEqual({ median: 0, mean: 0.33, max: 1 });
  });

  it('computes retrieval rate and retrieval→outcome co-occurrence', () => {
    const signals = computePracticeSignals(fixture());

    // A and C retrieved (non-empty ids); B's no-hit search does not count.
    expect(signals.retrievalRate).toBe(0.67);
    expect(signals.outcomesByRetrieval.retrieved).toEqual({
      committed: 1,
      abandoned: 0,
      unknown: 0,
    });
    expect(signals.outcomesByRetrieval.unretrieved).toEqual({
      committed: 0,
      abandoned: 1,
      unknown: 0,
    });
  });

  it('counts context-setup events (before the first tool_use)', () => {
    const signals = computePracticeSignals(fixture());
    // A: start + retrieval = 2 before its first edit; B: start + no-hit = 2;
    // C: never reaches a tool_use, so both its events count as setup.
    expect(signals.contextSetupEvents).toEqual({ median: 2, mean: 2, max: 2 });
  });

  it('negative: a lone command failure without a follow-up is not a retry', () => {
    const events = [
      ev(SID_A, 0, { ev: 'session_start', data: {} }),
      ev(SID_A, 1, { ev: 'tool_use', data: { kind: 'command', exit_code: 1 } }),
      ev(SID_A, 2, { ev: 'tool_use', data: { kind: 'edit', path: 'a.ts' } }),
    ];
    expect(computePracticeSignals(events).retries.max).toBe(0);
  });

  it('negative: no identity-bearing event field survives into the output', () => {
    const serialized = JSON.stringify(computePracticeSignals(fixture()));
    for (const forbidden of [
      SID_A,
      SID_B,
      SID_C,
      'claude-code',
      'claude-fable-5',
      'acme/api',
      'src/a.ts',
      'abc1234',
      '01JZMEM1',
      '"sid"',
      '"tool"',
      '"model"',
      '"repo"',
      '"branch"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('negative: empty input yields zeroed aggregates, not NaN', () => {
    const signals = computePracticeSignals([]);
    expect(signals.sessions).toBe(0);
    expect(signals.retrievalRate).toBe(0);
    expect(signals.retries).toEqual({ median: 0, mean: 0, max: 0 });
    expect(signals.explorationByCodemap).toEqual({
      withCodemap: null,
      withoutCodemap: null,
      reductionPct: null,
    });
  });
});

describe('exploration measurement (C2 explore kind, D6 §4.8 instrument)', () => {
  /** One session with codemap retrieval + few explores, one without + many. */
  function explorationFixture(): SessionEvent[] {
    const events: SessionEvent[] = [
      ev(SID_A, 0, { ev: 'session_start', data: {} }),
      ev(SID_A, 1, {
        ev: 'memory_retrieved',
        data: { ids: ['cm:src/router.ts', '01JZMEM1'] },
      }),
      ev(SID_A, 2, {
        ev: 'tool_use',
        data: { kind: 'explore', path: 'src/a.ts' },
      }),
      ev(SID_A, 3, { ev: 'tool_use', data: { kind: 'explore' } }),
      ev(SID_A, 4, {
        ev: 'tool_use',
        data: { kind: 'edit', path: 'src/a.ts' },
      }),

      ev(SID_B, 0, { ev: 'session_start', data: {} }),
      ev(SID_B, 1, { ev: 'memory_retrieved', data: { ids: ['01JZMEM1'] } }),
    ];
    for (let i = 0; i < 10; i += 1) {
      events.push(
        ev(SID_B, 2 + i, { ev: 'tool_use', data: { kind: 'explore' } }),
      );
    }
    return events;
  }

  it('computes exploration per session and the codemap split with reduction %', () => {
    const signals = computePracticeSignals(explorationFixture());
    expect(signals.exploration.max).toBe(10);
    expect(signals.explorationByCodemap).toEqual({
      withCodemap: 2,
      withoutCodemap: 10,
      reductionPct: 80, // (10 - 2) / 10
    });
  });

  it('negative: no codemap-retrieving sessions → reduction is null, never fabricated', () => {
    const signals = computePracticeSignals(
      explorationFixture().filter((e) => e.sid !== SID_A),
    );
    expect(signals.explorationByCodemap.withCodemap).toBeNull();
    expect(signals.explorationByCodemap.reductionPct).toBeNull();
  });

  it('negative: a memory-only retrieval does not count as codemap', () => {
    const signals = computePracticeSignals([
      ev(SID_C, 0, { ev: 'memory_retrieved', data: { ids: ['01JZMEM9'] } }),
      ev(SID_C, 1, { ev: 'tool_use', data: { kind: 'explore' } }),
    ]);
    expect(signals.explorationByCodemap.withCodemap).toBeNull();
    expect(signals.explorationByCodemap.withoutCodemap).toBe(1);
  });

  // R16.1 T7: the codemap query rate — the number that decides whether the
  // pull model worked at all (CM6 gate companion to the reduction %).
  it('computes the codemap query rate over sessions', () => {
    // SID_A retrieved a cm: entry; SID_B did not → 1 of 2 sessions.
    const signals = computePracticeSignals(explorationFixture());
    expect(signals.codemapQueryRate).toBe(0.5);
  });

  it('negative: codemap query rate is 0 (not NaN) with no sessions, and memory-only retrievals do not count', () => {
    expect(computePracticeSignals([]).codemapQueryRate).toBe(0);
    const memoryOnly = computePracticeSignals([
      ev(SID_C, 0, { ev: 'memory_retrieved', data: { ids: ['01JZMEM9'] } }),
    ]);
    expect(memoryOnly.codemapQueryRate).toBe(0);
  });
});
