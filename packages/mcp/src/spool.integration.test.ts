import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { Spool, SESSIONS_BRANCH } from './spool.js';
import { sessionRecordPath } from './paths.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-spool-repo-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  git(['commit', '-q', '--allow-empty', '-m', 'init'], dir);
  return dir;
}

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-spool-home-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function ev(sid: string, ev: SessionEvent['ev'], data: Record<string, unknown>): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-05T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev,
    data,
  } as SessionEvent;
}

function captureLogger() {
  const warns: string[] = [];
  const noop = (): void => {};
  const logger = {
    warn: (msg: string) => warns.push(msg),
    debug: noop,
    info: noop,
    error: noop,
    child: () => logger,
  };
  return Object.assign(logger, { warns });
}

describe('Spool (M5.3)', () => {
  it('appends events to spool/<sid>.jsonl', async () => {
    const runtimeDir = await tempHome();
    const repo = await tempRepo();
    const spool = new Spool({ runtimeDir, brainDir: join(repo, '.teambrain'), push: false });
    await spool.handle(ev('sess-1', 'session_start', {}));
    await spool.handle(ev('sess-1', 'tool_use', { kind: 'edit', path: 'src/a.ts' }));
    const lines = (await readFile(sessionRecordPath(runtimeDir, 'sess-1'), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] as string).data).toEqual({
      kind: 'edit',
      path: 'src/a.ts',
    });
  });

  it('publishes the record to the never-merged teambrain/sessions branch on session_end', async () => {
    const runtimeDir = await tempHome();
    const repo = await tempRepo();
    const spool = new Spool({ runtimeDir, brainDir: repo, push: false });
    await spool.handle(ev('sess-9', 'session_start', {}));
    await spool.handle(
      ev('sess-9', 'session_end', {
        outcome: 'committed',
        duration_s: 12,
        turns: 2,
        commit_shas: [],
      }),
    );

    // Branch exists and holds the record under sessions/.
    expect(git(['rev-parse', '--verify', `refs/heads/${SESSIONS_BRANCH}`], repo)).toBeTruthy();
    const stored = git(['show', `${SESSIONS_BRANCH}:sessions/sess-9.jsonl`], repo);
    expect(stored).toContain('session_end');

    // main must not carry the sessions tree (orphan branch, never merged).
    const mainTree = git(['ls-tree', '--name-only', 'main'], repo);
    expect(mainTree).not.toContain('sessions');
    // Independent history: the sessions branch has its own root commit.
    const sessionsRoot = git(['rev-list', '--max-parents=0', SESSIONS_BRANCH], repo);
    const mainRoot = git(['rev-list', '--max-parents=0', 'main'], repo);
    expect(sessionsRoot).not.toBe(mainRoot);
  });

  it('keeps the record local when there is no git repo (graceful)', async () => {
    const runtimeDir = await tempHome();
    const nonRepo = await tempHome();
    const spool = new Spool({ runtimeDir, brainDir: nonRepo, push: false });
    await expect(
      spool.handle(
        ev('sess-x', 'session_end', {
          outcome: 'unknown',
          duration_s: 0,
          turns: 0,
          commit_shas: [],
        }),
      ),
    ).resolves.toBeUndefined();
    expect(existsSync(sessionRecordPath(runtimeDir, 'sess-x'))).toBe(true);
  });

  it('evicts oldest records and warns when the cap is exceeded', async () => {
    const runtimeDir = await tempHome();
    const repo = await tempRepo();
    const logger = captureLogger();
    const spool = new Spool({
      runtimeDir,
      brainDir: join(repo, '.teambrain'),
      push: false,
      maxBytes: 400,
      logger,
    });
    for (let i = 0; i < 6; i++) {
      // Non-session_end events so nothing commits; each record ~150 bytes.
      await spool.handle(ev(`sess-cap-${i}`, 'tool_use', { kind: 'edit', path: `src/file-${i}.ts` }));
      await spool.handle(ev(`sess-cap-${i}`, 'tool_use', { kind: 'command' }));
    }
    expect(logger.warns.some((m) => m.includes('evicted'))).toBe(true);
  });
});
