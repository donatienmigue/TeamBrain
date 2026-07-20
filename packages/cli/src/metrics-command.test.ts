import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memoryPath,
  serializeMemoryFile,
  type Memory,
  type SessionEvent,
} from '@teambrain/core';
import type { SessionRecord, SessionSource } from '@teambrain/distill';
import { runMetricsCommand } from './metrics-command.js';

// PM §5 / Acceptance §7: tb metrics is read-only and reuses the existing
// aggregation — no new capture, no new privacy surface.

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempBrain(memories: Memory[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-metrics-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const brainDir = join(dir, '.teambrain');
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'brain.yaml'), 'version: 1\n', 'utf8');
  for (const memory of memories) {
    const abs = join(brainDir, memoryPath(memory));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeMemoryFile(memory), 'utf8');
  }
  return brainDir;
}

function memory(id: string, title: string, created: string): Memory {
  return {
    id,
    class: 'learning',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title,
    created,
    evidence: { sessions: ['s1'], commits: [] },
    supersedes: [],
    tags: [],
    ttl_days: null,
    body: `Body for ${title}.`,
  };
}

function ev(evName: SessionEvent['ev'], data: object): SessionEvent {
  return {
    v: 1,
    sid: 's1',
    t: '2026-07-01T00:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/web',
    branch: 'main',
    ev: evName,
    data,
  } as SessionEvent;
}

function sessionSource(events: SessionEvent[]): SessionSource {
  const record: SessionRecord = { sid: 's1', events, commitShas: [] };
  return { head: () => 'tip', readNewRecords: () => [record] };
}

const M1 = '01JD01000000000000000000AA';

describe('tb metrics (PM §5)', () => {
  it('prints a read-only snapshot with context-efficiency metrics (json)', async () => {
    const brainDir = tempBrain([memory(M1, 'Cache config', '2026-01-01')]);
    const emptyRuntime = mkdtempSync(join(tmpdir(), 'tb-metrics-rt-'));
    cleanups.push(() => rmSync(emptyRuntime, { recursive: true, force: true }));

    const { exitCode, output } = await runMetricsCommand('.', {
      json: true,
      brainDir,
      runtimeDir: emptyRuntime, // no daemon → latency empty, index null
      now: new Date('2026-07-06T00:00:00Z'),
      sessions: sessionSource([
        ev('memory_retrieved', {
          ids: ['cm:src/a.ts', M1],
          via: 'context',
          tokens: 900,
          required: 1,
          required_tokens: 250,
        }),
        ev('tool_use', { kind: 'explore', path: 'src/a.ts' }),
      ]),
    });

    expect(exitCode).toBe(0);
    const snap = JSON.parse(output) as {
      index: unknown;
      latency: { injection: { samples: number } };
      contextMetrics: {
        injectionWeight: { median: number };
        requiredLoad: { count: number };
        utilization: { rate: number | null };
        servedStaleness: { rate: number | null };
      };
      netEfficiency: { verdict: string };
    };
    // Context efficiency computed from the injection event.
    expect(snap.contextMetrics.injectionWeight.median).toBe(900);
    expect(snap.contextMetrics.requiredLoad.count).toBe(1);
    // cm:src/a.ts injected and later touched → 100% utilization.
    expect(snap.contextMetrics.utilization.rate).toBe(1);
    // M1 injected, created 2026-01-01 (>90d before now) → served stale.
    expect(snap.contextMetrics.servedStaleness.rate).toBe(1);
    // Daemon down → latency has zero samples, but the shape is present.
    expect(snap.latency.injection.samples).toBe(0);
    expect(snap.netEfficiency.verdict).toBe('insufficient-data');
  });

  it('human output is read-only and labels the snapshot', async () => {
    const brainDir = tempBrain([memory(M1, 'Cache config', '2026-07-01')]);
    const { exitCode, output } = await runMetricsCommand('.', {
      brainDir,
      sessions: sessionSource([]),
      now: new Date('2026-07-06T00:00:00Z'),
    });
    expect(exitCode).toBe(0);
    expect(output).toContain('tb metrics (local snapshot, read-only)');
    expect(output).toContain('injection weight');
  });

  it('fails cleanly outside a git repo boundary is handled (missing brain)', async () => {
    const { exitCode, output } = await runMetricsCommand('.', {
      brainDir: join(tmpdir(), 'tb-metrics-does-not-exist', '.teambrain'),
      sessions: sessionSource([]),
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('run `tb init` first');
  });
});
