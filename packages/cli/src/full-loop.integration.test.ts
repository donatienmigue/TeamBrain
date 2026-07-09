import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { startDaemon, type DaemonHandle } from '@teambrain/mcp';
import { HashingEmbedder } from '@teambrain/index';
import {
  fakeProvider,
  type SessionRecord,
  type SessionSource,
} from '@teambrain/distill';
import { runInitCommand } from './init/init-command.js';
import { INIT_BRANCH } from './init/branch.js';
import { runDistillCommand } from './distill/distill-command.js';
import { runRetireCommand } from './retire/retire-command.js';

// M8.1 — the release loop test. Drives the whole product through its CLI
// entrypoints: tb init → merge → tb serve → replay sessions → tb distill →
// merge → assert the new memory is served by memory_search → tb retire →
// merge → assert it is gone (the R5 negative). Each stage uses real git; the
// LLM + embedder are injected so the run is offline and deterministic.

// Heavy: many git ops plus a live daemon. Give it generous headroom under the
// parallel full-monorepo run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const REPOS_DIR = fileURLToPath(
  new URL('../../../testdata/repos', import.meta.url),
);

const tempDirs: string[] = [];
const daemons: DaemonHandle[] = [];

afterEach(async () => {
  while (daemons.length > 0) await daemons.pop()?.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeGitRepo(fixture: string): string {
  const dir = makeTempDir('tb-loop-repo-');
  cpSync(join(REPOS_DIR, fixture), dir, { recursive: true });
  git(['init', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'loop@example.invalid'], dir);
  git(['config', 'user.name', 'Loop Test'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-m', 'fixture baseline'], dir);
  return dir;
}

function edit(sid: string, path: string): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-05T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/billing',
    branch: 'main',
    ev: 'tool_use',
    data: { kind: 'edit', path },
  } as SessionEvent;
}

// One path_struggle cluster: two sessions editing the same file.
const REPLAYED_SESSIONS: SessionRecord[] = [
  {
    sid: 's1',
    events: [edit('s1', 'src/reconcile/ledger.ts')],
    commitShas: ['c1'],
  },
  {
    sid: 's2',
    events: [edit('s2', 'src/reconcile/ledger.ts')],
    commitShas: ['c2'],
  },
];

const NEW_ID = '01JD00000000000000000000ZZ';
const NOW = new Date('2026-07-06T00:00:00Z');

// The distiller's draft for the cluster — deliberately distinct from the
// billing-flavoured brain the fixture imports, so dedup keeps it.
const provider = fakeProvider(({ prompt }) =>
  prompt.includes('CONTRADICTION CHECK')
    ? { verdict: 'consistent' }
    : {
        class: 'learning',
        title: 'Rotate deployment credentials every quarter',
        body:
          'Rotate all production deployment credentials on a quarterly ' +
          'cadence and immediately after any suspected leak, to bound the ' +
          'blast radius of a compromised token.',
        tags: ['security'],
      },
);

function replaySource(): SessionSource {
  return { head: () => 'tip', readNewRecords: () => REPLAYED_SESSIONS };
}

async function searchIds(
  daemon: DaemonHandle,
  query: string,
): Promise<string[]> {
  const results = await daemon.tools.memorySearch({ query, k: 8 });
  return results.map((r) => r.id);
}

describe('full loop (M8.1)', () => {
  it('init → distill → search → retire, end to end', async () => {
    const repo = makeGitRepo('claude-md-only');

    // 1–2. tb init, then merge the init branch to main.
    const init = await runInitCommand(repo, { interview: false });
    expect(init.exitCode).toBe(0);
    git(['merge', '--no-edit', INIT_BRANCH], repo);

    // 3. tb serve — a live daemon over the merged brain (lexical-only).
    const runtimeDir = makeTempDir('tb-loop-rt-');
    const daemon = await startDaemon({
      runtimeDir,
      brainDir: join(repo, '.teambrain'),
      embedder: null,
    });
    daemons.push(daemon);

    // 4. Replay sessions through the distiller and open a proposals branch.
    const embedder = new HashingEmbedder();
    const distill = await runDistillCommand(repo, {
      provider,
      embed: (texts) => embedder.embedDocs(texts),
      sessions: replaySource(),
      prs: { readMergedPRs: () => [], readTeamBrainPRBodies: () => [] },
      now: NOW,
      newId: () => NEW_ID,
    });
    expect(distill.exitCode).toBe(0);

    // 5. Merge the proposal PR.
    git(['merge', '--no-edit', 'teambrain/proposals-2026-07-06'], repo);

    // 6. The new memory is now served by memory_search.
    await daemon.reindexNow();
    expect(await searchIds(daemon, 'rotate deployment credentials')).toContain(
      NEW_ID,
    );

    // 7. tb retire, then merge the retirement PR.
    const retire = runRetireCommand(repo, NEW_ID, 'covered by the runbook', {
      openPr: false,
    });
    expect(retire.exitCode).toBe(0);
    git(['merge', '--no-edit', `teambrain/retire-${NEW_ID}`], repo);

    // 8. R5: the retired memory disappears from memory_search.
    await daemon.reindexNow();
    expect(
      await searchIds(daemon, 'rotate deployment credentials'),
    ).not.toContain(NEW_ID);
  });
});
