import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { createTools, openBackend } from '@teambrain/mcp';
import { aggregateDigest } from './aggregate.js';
import {
  buildFlightDeckReport,
  renderFlightDeckMarkdown,
  type FlightDeckReport,
} from './flightdeck.js';

// E2 FlightDeck v0. Suppression is a privacy invariant (§E.2): it must fire in
// the aggregator so `--format json` cannot leak a small cell the markdown
// hides; reports are derived artifacts and must never be indexed.

const temps: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function ev(sid: string, kind: string, data: unknown): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-01T00:00:00.000Z',
    tool: 'claude-code',
    model: 'm',
    repo: 'r',
    branch: 'b',
    ev: kind,
    data,
  } as unknown as SessionEvent;
}

function session(sid: string, outcome: string): SessionEvent[] {
  return [
    ev(sid, 'session_start', {}),
    ev(sid, 'session_end', {
      outcome,
      duration_s: 0,
      turns: 1,
      commit_shas: [],
    }),
  ];
}

describe('FlightDeck — small-cell suppression (at the aggregator)', () => {
  it('a 3-session window suppresses every derived cell, and json leaks no value', () => {
    const events = [
      ...session('s1', 'committed'),
      ...session('s2', 'abandoned'),
      ...session('s3', 'unknown'),
    ];
    const report = aggregateDigest({
      events,
      active: [],
      retiredCount: 0,
      proposedCount: 0,
      rules: [],
      now: new Date('2026-07-08T00:00:00Z'),
    });
    const fd = buildFlightDeckReport(report, {
      generatedAt: new Date('2026-07-08T00:00:00Z'),
    });

    // Every derived cell is suppressed (n < 5).
    expect(fd.outcomeMix.suppressed).toBe(true);
    expect(fd.friction.suppressed).toBe(true);
    expect(fd.memory.retrievalRate.suppressed).toBe(true);
    expect(fd.memory.noHitSearches.suppressed).toBe(true);
    expect(fd.memory.outcomeByRetrieval.retrieved.suppressed).toBe(true);
    expect(fd.memory.outcomeByRetrieval.unretrieved.suppressed).toBe(true);
    expect(fd.governance.suppressed).toBe(true);
    expect(fd.exploration.suppressed).toBe(true);

    // The invariant that matters: --format json cannot leak what markdown hides.
    // A suppressed cell carries `n` but no `value`, so no value survives.
    expect(JSON.stringify(fd)).not.toContain('"value"');

    // And the markdown says so rather than showing a rounded number.
    expect(renderFlightDeckMarkdown(fd)).toContain('(suppressed)');
  });
});

describe('FlightDeck — golden report body', () => {
  it('renders a deterministic markdown body', () => {
    const fd: FlightDeckReport = {
      generatedAt: '2026-07-08T00:00:00.000Z',
      window: { sessions: 8, ended: 6 },
      outcomeMix: {
        n: 6,
        suppressed: false,
        value: { committed: 4, abandoned: 1, unknown: 1 },
      },
      friction: {
        n: 8,
        suppressed: false,
        value: { retriesMedian: 1, failedCommandsMedian: 2 },
      },
      memory: {
        retrievalRate: { n: 8, suppressed: false, value: 0.5 },
        noHitSearches: { n: 8, suppressed: false, value: 3 },
        outcomeByRetrieval: {
          retrieved: {
            n: 5,
            suppressed: false,
            value: { committed: 3, abandoned: 1, unknown: 1 },
          },
          unretrieved: { n: 3, suppressed: true },
        },
      },
      governance: {
        n: 6,
        suppressed: false,
        value: { mergedProposalPRs: 6, medianHoursToMerge: 12.5 },
      },
      exploration: { n: 4, suppressed: true },
    };
    expect(renderFlightDeckMarkdown(fd)).toMatchInlineSnapshot(`
      "# TeamBrain FlightDeck — weekly report

      _Generated 2026-07-08T00:00:00.000Z. Team-level, metadata-only, aggregate-by-construction._
      _This is **not** a productivity metric and **not** per-person; aggregates over fewer than 5 units are suppressed, not rounded._

      Window: **8** sessions, **6** ended.

      ## Outcome mix

      committed 4 · abandoned 1 · unknown 1 (n=6)

      _Cursor sessions report \`unknown\` by construction (no lifecycle hooks — no commit or outcome capture), which inflates \`unknown\`._

      ## Friction

      Median retries/session **1**, median failed commands/session **2** (n=8).

      ## Memory leverage

      - Retrieval rate: **50%** of sessions retrieved ≥1 memory (n=8).
      - No-hit searches (documented brain gaps): **3**.

      **Outcome by retrieval** (labelled *correlation*, not causation):
      - retrieved: committed 3 · abandoned 1 · unknown 1 (n=5).
      - unretrieved: \`n<5\` (suppressed) — n=3.

      ## Governance friction

      **6** merged proposal PR(s), median **12.5h** to merge (n=6).

      ## Exploration (CodeMap holdout)

      \`n<5\` (suppressed) — smaller arm has 4 session(s).

      ## Memories at risk

      _Populated by evidence drift detection (E3), which is not yet enabled._
      "
    `);
  });
});

describe('FlightDeck — reports are never indexed (negative test)', () => {
  it('a report under .teambrain/reports/ does not appear in memory_search', async () => {
    const repo = tmp('tb-fd-brain-');
    const brainDir = join(repo, '.teambrain');
    mkdirSync(join(brainDir, 'memories', 'conventions'), { recursive: true });
    writeFileSync(
      join(
        brainDir,
        'memories',
        'conventions',
        '01KWZCBRH96QQWCB99QWYKGG56-x.md',
      ),
      [
        '---',
        'id: 01KWZCBRH96QQWCB99QWYKGG56',
        'class: convention',
        'scope: team',
        'status: active',
        'priority: advisory',
        'title: "indexed memory fixture"',
        'created: 2026-07-07',
        'supersedes: []',
        'tags: []',
        'ttl_days: null',
        '---',
        '',
        'This memory mentions MEMORYONLYTOKEN and should be searchable.',
        '',
      ].join('\n'),
    );
    // The report lands OUTSIDE memories/ — the indexer only scans memories/**.
    mkdirSync(join(brainDir, 'reports'), { recursive: true });
    writeFileSync(
      join(brainDir, 'reports', '2026-W30.md'),
      '# FlightDeck\n\nThis report mentions REPORTONLYTOKEN.\n',
    );

    const home = tmp('tb-fd-home-');
    const handle = await openBackend({
      runtimeDir: home,
      brainDir,
      embedder: null,
    });
    try {
      const tools = createTools(handle.context);
      const memoryHits = await tools.memorySearch({ query: 'MEMORYONLYTOKEN' });
      expect(memoryHits.length).toBeGreaterThan(0); // the index works
      const reportHits = await tools.memorySearch({ query: 'REPORTONLYTOKEN' });
      expect(reportHits).toEqual([]); // the report was never indexed
    } finally {
      handle.close();
    }
  });
});
