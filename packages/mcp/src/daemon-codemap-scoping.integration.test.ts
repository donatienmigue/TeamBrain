import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeCodemapEntry, type SessionEvent } from '@teambrain/core';
import { startDaemon, type DaemonHandle } from './daemon.js';
import { requestSessionContext, sendHookEvent } from './hook-client.js';
import { fixtureBrainDir } from './test-helpers.js';

// R16.1 (P1) end-to-end: the daemon scopes the codemap slice by the paths a
// session actually touches (tool_use hook events), and falls back to the
// index-only block when it has no signal — never to a newest-first slice.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function writeEntry(
  brainDir: string,
  path: string,
  body: string,
  updated: string,
): void {
  const file = join(brainDir, 'codemap', 'files', `${path}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    serializeCodemapEntry({
      frontmatter: { v: 1, path, hash: 'b'.repeat(64), updated },
      body,
    }),
    'utf8',
  );
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function startCodemapDaemon(): Promise<
  DaemonHandle & { runtimeDir: string; repoDir: string }
> {
  const repoDir = await mkdtemp(join(tmpdir(), 'tb-cm-scope-repo-'));
  cleanups.push(() => rm(repoDir, { recursive: true, force: true }));
  const brainDir = join(repoDir, '.teambrain');
  await cp(fixtureBrainDir(), brainDir, { recursive: true });
  await writeFile(
    join(brainDir, 'brain.yaml'),
    'version: 1\ncodemap:\n  enabled: true\n',
    'utf8',
  );
  writeEntry(
    brainDir,
    'src/payments/retry.ts',
    'Retries webhook deliveries with backoff.',
    '2026-07-10',
  );
  // Newer than the payments entry: V1 "newest" ordering would serve this.
  writeEntry(
    brainDir,
    'docs-tooling.ts',
    'Unrelated recently-changed tooling file.',
    '2026-07-14',
  );
  git(['init', '-q', '-b', 'main'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'brain'], repoDir);

  const runtimeDir = await mkdtemp(join(tmpdir(), 'tb-cm-scope-home-'));
  cleanups.push(() => rm(runtimeDir, { recursive: true, force: true }));
  const daemon = await startDaemon({
    runtimeDir,
    brainDir,
    embedder: null,
    watchIntervalMs: 100,
    gitFetchIntervalMs: 3_600_000,
    heartbeatIntervalMs: 200,
  });
  cleanups.push(() => daemon.close());
  return Object.assign(daemon, { runtimeDir, repoDir });
}

function exploreEvent(path: string): SessionEvent {
  return {
    v: 1,
    sid: 'sid-scoping-test',
    t: '2026-07-15T10:00:00+00:00',
    tool: 'claude-code',
    model: 'claude-fable-5',
    repo: 'fixture',
    branch: 'main',
    ev: 'tool_use',
    data: { kind: 'explore', path },
  };
}

describe('daemon codemap scoping (R16.1 P1)', () => {
  it('no signal → index block only; touched paths → their maps, not the newest entry', async () => {
    const daemon = await startCodemapDaemon();

    // Before any session activity: orientation only, no pushed slice.
    const before = await requestSessionContext(daemon.runtimeDir);
    expect(before).toContain('CodeMap: this repo has a generated map');
    expect(before).not.toContain('[codemap ·');
    expect(before).not.toContain('Unrelated recently-changed tooling file.');

    // A session touches a payments file (absolute path, exercises
    // normalization back to the repo-relative codemap path).
    await sendHookEvent(
      daemon.runtimeDir,
      exploreEvent(join(daemon.repoDir, 'src', 'payments', 'retry.ts')),
    );
    const scoped = await waitFor(async () => {
      const bundle = await requestSessionContext(daemon.runtimeDir);
      return bundle.includes('Retries webhook deliveries with backoff.');
    });
    expect(scoped).toBe(true);

    const after = await requestSessionContext(daemon.runtimeDir);
    expect(after).toContain(
      '[codemap · generated from src/payments/retry.ts · not human-approved]',
    );
    // The newer-but-unrelated entry still does not ride along.
    expect(after).not.toContain('Unrelated recently-changed tooling file.');
  });
});
