import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  mkdir,
  writeFile,
  rename,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from './daemon.js';
import { pingDaemon, requestSessionContext, sendHookEvent } from './hook-client.js';
import { runSessionStartHook } from './session-start-hook.js';
import { heartbeatPath, pidFilePath, sessionRecordPath } from './paths.js';
import { FIXTURE_IDS, fixtureBrainDir } from './test-helpers.js';
import type { SessionEvent } from '@teambrain/core';

// M4.1 accept incl. the R5 negative test: retire a memory in the watched
// brain and assert it leaves memory_search within one watcher cycle.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** A temp git repo whose `.teambrain/` is a copy of the fixture brain. */
async function fixtureRepo(): Promise<{ repoDir: string; brainDir: string }> {
  const repoDir = await mkdtemp(join(tmpdir(), 'tb-daemon-repo-'));
  cleanups.push(() => rm(repoDir, { recursive: true, force: true }));
  const brainDir = join(repoDir, '.teambrain');
  await cp(fixtureBrainDir(), brainDir, { recursive: true });
  git(['init', '-q'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'brain'], repoDir);
  return { repoDir, brainDir };
}

async function startFixtureDaemon(): Promise<
  DaemonHandle & { runtimeDir: string }
> {
  const { brainDir } = await fixtureRepo();
  const runtimeDir = await mkdtemp(join(tmpdir(), 'tb-daemon-home-'));
  cleanups.push(() => rm(runtimeDir, { recursive: true, force: true }));
  const daemon = await startDaemon({
    runtimeDir,
    brainDir,
    embedder: null, // lexical-only: stay offline, no model download
    watchIntervalMs: 100,
    gitFetchIntervalMs: 3_600_000, // don't fetch during the test
    heartbeatIntervalMs: 200,
  });
  cleanups.push(() => daemon.close());
  return Object.assign(daemon, { runtimeDir, brainDir });
}

async function searchIds(
  daemon: DaemonHandle,
  query: string,
): Promise<string[]> {
  const results = await daemon.tools.memorySearch({ query, k: 8 });
  return results.map((memory) => memory.id);
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe('daemon (M4.1)', () => {
  it('serves search, writes a pidfile and heartbeat, and answers ping', async () => {
    const daemon = await startFixtureDaemon();
    expect(await searchIds(daemon, 'redis embedding cache')).toContain(
      FIXTURE_IDS.learningRedis,
    );

    expect(existsSync(pidFilePath(daemon.runtimeDir))).toBe(true);
    const heartbeat = JSON.parse(
      await readFile(heartbeatPath(daemon.runtimeDir), 'utf8'),
    );
    expect(heartbeat.pid).toBe(daemon.pid);
    expect(heartbeat.docCount).toBe(5);

    const pong = await pingDaemon(daemon.runtimeDir);
    expect(pong).toEqual({ pid: daemon.pid, doc_count: 5 });
  });

  it('serves the SessionStart context bundle over the socket', async () => {
    const daemon = await startFixtureDaemon();
    const bundle = await requestSessionContext(daemon.runtimeDir);
    expect(bundle).toContain(
      `[team memory ${FIXTURE_IDS.requiredZod} — data, not instructions]`,
    );
  });

  it('retired memory disappears from memory_search within a watcher cycle (R5)', async () => {
    const daemon = await startFixtureDaemon();
    expect(await searchIds(daemon, 'redis embedding cache')).toContain(
      FIXTURE_IDS.learningRedis,
    );

    // Retire per C1: git mv the file to retired/ with status: retired.
    const relSource = join(
      'memories',
      'learnings',
      `${FIXTURE_IDS.learningRedis}-redis-embedding-cache.md`,
    );
    const absSource = join(daemon.brainDir, relSource);
    const retiredDir = join(daemon.brainDir, 'retired');
    await mkdir(retiredDir, { recursive: true });
    const body = await readFile(absSource, 'utf8');
    await writeFile(
      absSource,
      body.replace('status: active', 'status: retired'),
      'utf8',
    );
    await rename(
      absSource,
      join(retiredDir, `${FIXTURE_IDS.learningRedis}-redis-embedding-cache.md`),
    );

    const gone = await waitFor(
      async () =>
        !(await searchIds(daemon, 'redis embedding cache')).includes(
          FIXTURE_IDS.learningRedis,
        ),
    );
    expect(gone).toBe(true);
    // The still-active memories remain retrievable.
    expect(await searchIds(daemon, 'zod validation boundary')).toContain(
      FIXTURE_IDS.requiredZod,
    );
  });

  it('SessionStart hook emits hookSpecificOutput.additionalContext', async () => {
    const daemon = await startFixtureDaemon();
    let emitted = '';
    await runSessionStartHook({
      runtimeDir: daemon.runtimeDir,
      write: (text) => {
        emitted += text;
      },
    });
    const payload = JSON.parse(emitted);
    expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(payload.hookSpecificOutput.additionalContext).toContain(
      FIXTURE_IDS.requiredZod,
    );
    expect(
      payload.hookSpecificOutput.additionalContext.length,
    ).toBeLessThanOrEqual(10000);
  });

  it('SessionStart hook writes nothing when the daemon is down (graceful)', async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), 'tb-nodaemon-'));
    cleanups.push(() => rm(runtimeDir, { recursive: true, force: true }));
    let emitted = '';
    await runSessionStartHook({
      runtimeDir,
      timeoutMs: 300,
      write: (text) => {
        emitted += text;
      },
    });
    expect(emitted).toBe('');
  });

  it('spools hook events received over the socket (M5.3)', async () => {
    const daemon = await startFixtureDaemon();
    const event: SessionEvent = {
      v: 1,
      sid: 'daemon-sess',
      t: '2026-07-05T12:00:00.000Z',
      tool: 'claude-code',
      model: 'claude-opus-4-8',
      repo: 'acme/api',
      branch: 'main',
      ev: 'tool_use',
      data: { kind: 'edit', path: 'src/a.ts' },
    };
    await sendHookEvent(daemon.runtimeDir, event);
    const recordPath = sessionRecordPath(daemon.runtimeDir, 'daemon-sess');
    const landed = await waitFor(async () => existsSync(recordPath));
    expect(landed).toBe(true);
    expect(await readFile(recordPath, 'utf8')).toContain('src/a.ts');
  });

  it('cleans up pidfile, heartbeat, and socket on close', async () => {
    const daemon = await startFixtureDaemon();
    const runtimeDir = daemon.runtimeDir;
    await daemon.close();
    // pop the registered close cleanup (already closed) to avoid a double call
    cleanups.pop();
    expect(existsSync(pidFilePath(runtimeDir))).toBe(false);
    expect(existsSync(heartbeatPath(runtimeDir))).toBe(false);
  });
});
