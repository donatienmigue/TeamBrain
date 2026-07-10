import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionEventSchema } from '@teambrain/core';
import { CursorInterceptor, type CursorMcpCall } from './interceptor.js';

function fixturePayloads(): CursorMcpCall[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(
    here,
    '..',
    '..',
    '..',
    '..',
    'testdata',
    'sessions',
    'raw-cursor.jsonl',
  );
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CursorMcpCall);
}

describe('CursorInterceptor (C6.1 parity)', () => {
  it('translates Cursor MCP calls into C2-valid events', () => {
    const payloads = fixturePayloads();
    const interceptor = new CursorInterceptor({
      repo: 'acme/api',
      branch: 'main',
      tool: 'cursor',
      model: 'unknown',
      redactionLevel: 'strict',
      now: () => new Date('2026-07-06T12:00:00.000Z'),
    });

    const events = payloads.flatMap((p) => interceptor.processCall(p));

    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(() => sessionEventSchema.parse(event)).not.toThrow();
    }

    expect(events.map((e) => e.ev)).toEqual([
      'session_start',
      'candidate_proposed',
      'session_end',
    ]);
  });
});

describe('CursorInterceptor idle-timeout session end', () => {
  const T0 = new Date('2026-07-06T12:00:00.000Z').getTime();

  function interceptorAt(clock: { nowMs: number }): CursorInterceptor {
    return new CursorInterceptor(
      {
        repo: 'acme/api',
        branch: 'main',
        tool: 'cursor',
        model: 'unknown',
        redactionLevel: 'strict',
        now: () => new Date(clock.nowMs),
      },
      { idleTimeoutMs: 30 * 60 * 1000 },
    );
  }

  it('ends a never-proposing session via flushIdle after the timeout', () => {
    const clock = { nowMs: T0 };
    const interceptor = interceptorAt(clock);

    const started = interceptor.processCall({ method: 'memory_context' });
    expect(started.map((e) => e.ev)).toEqual(['session_start']);
    const sid = started[0]?.sid;

    clock.nowMs = T0 + 31 * 60 * 1000;
    const flushed = interceptor.flushIdle();
    expect(flushed.map((e) => e.ev)).toEqual(['session_end']);
    const end = flushed[0];
    expect(end?.sid).toBe(sid);
    expect(sessionEventSchema.parse(end)).toBeTruthy();
    if (end?.ev === 'session_end') {
      expect(end.data.outcome).toBe('unknown');
      // The session ended at its last activity (T0), not when noticed.
      expect(end.data.duration_s).toBe(0);
      expect(end.data.commit_shas).toEqual([]);
    }
  });

  it('ends a stale session before interpreting the next call, starting a fresh one', () => {
    const clock = { nowMs: T0 };
    const interceptor = interceptorAt(clock);

    const first = interceptor.processCall({ method: 'memory_context' });
    clock.nowMs = T0 + 5 * 60 * 1000;
    interceptor.processCall({ method: 'memory_search' });

    clock.nowMs = T0 + 60 * 60 * 1000;
    const events = interceptor.processCall({ method: 'memory_context' });
    expect(events.map((e) => e.ev)).toEqual(['session_end', 'session_start']);
    expect(events[0]?.sid).toBe(first[0]?.sid);
    expect(events[1]?.sid).not.toBe(first[0]?.sid);
    if (events[0]?.ev === 'session_end') {
      // start → last activity (5 min), not start → detection (60 min).
      expect(events[0].data.duration_s).toBe(5 * 60);
      expect(events[0].data.turns).toBe(2);
    }
  });

  it('negative: activity within the timeout never emits session_end', () => {
    const clock = { nowMs: T0 };
    const interceptor = interceptorAt(clock);

    interceptor.processCall({ method: 'memory_context' });
    for (let i = 1; i <= 4; i += 1) {
      clock.nowMs = T0 + i * 29 * 60 * 1000; // each gap just under the limit
      const events = interceptor.processCall({ method: 'memory_search' });
      expect(events).toEqual([]);
    }
    // Still under the limit since the last activity: flushIdle is a no-op.
    clock.nowMs += 29 * 60 * 1000;
    expect(interceptor.flushIdle()).toEqual([]);
  });

  it('negative: flushIdle with no open session is a no-op', () => {
    const clock = { nowMs: T0 };
    const interceptor = interceptorAt(clock);
    clock.nowMs = T0 + 24 * 60 * 60 * 1000;
    expect(interceptor.flushIdle()).toEqual([]);
  });
});
