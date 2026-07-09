import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import { Spool, SESSIONS_BRANCH } from './spool.js';
import { userScopeDir, ensureUserScopeDir } from './user-paths.js';

// C7 / AUDIT.md F4: "the sync code must be physically unable to read
// ~/.teambrain/user/ (separate module without that path in scope; asserted
// by test)" and the testing rule "user-scope files absent from any pushed
// tree, asserted on the git object level". Two layers:
//   1. Module boundary — the sync code's import graph never references the
//      user path (static source assertion over spool.ts + its local imports).
//   2. Behavior — a seeded user/ store never appears in ANY git object of
//      the sessions branch, locally or on the pushed remote.

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function ev(
  sid: string,
  eventName: SessionEvent['ev'],
  data: Record<string, unknown>,
): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-09T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev: eventName,
    data,
  } as SessionEvent;
}

/** spool.ts plus, transitively, every local module it imports. */
function syncCodeSources(): Array<{ file: string; source: string }> {
  const visited = new Set<string>();
  const queue = ['./spool.js'];
  const sources: Array<{ file: string; source: string }> = [];
  while (queue.length > 0) {
    const spec = queue.pop() as string;
    const file = resolve(SRC_DIR, spec.replace(/\.js$/, '.ts'));
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    sources.push({ file, source });
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(match[1] as string);
    }
  }
  return sources;
}

describe('C7 user-scope physical separation (F4)', () => {
  it('the sync code cannot name the user dir (module-boundary assertion)', () => {
    const sources = syncCodeSources();
    // The walk must actually cover the sync module and its path helpers —
    // guard against a refactor making this test vacuous.
    const files = sources.map((entry) => entry.file);
    expect(files.some((file) => file.endsWith('spool.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('paths.ts'))).toBe(true);

    for (const { file, source } of sources) {
      expect(
        source.includes('user-paths'),
        `${file} must not import the user-scope module`,
      ).toBe(false);
      expect(
        /['"`]user['"`]|\/user\b|\buser\//.test(source),
        `${file} must not reference the user/ path segment`,
      ).toBe(false);
    }
  });

  it('user-scope files never reach any git object, local or pushed', async () => {
    const runtimeDir = await tempDir('tb-user-sep-home-');
    const repo = await tempDir('tb-user-sep-repo-');
    const remote = await tempDir('tb-user-sep-remote-');
    git(['init', '-q', '--bare'], remote);
    git(['init', '-q', '-b', 'main'], repo);
    git(['config', 'user.email', 't@example.com'], repo);
    git(['config', 'user.name', 'T'], repo);
    git(['commit', '-q', '--allow-empty', '-m', 'init'], repo);
    git(['remote', 'add', 'origin', remote], repo);

    // Seed the user-scope store with unmistakable private content.
    const MARKER = 'USER-SCOPE-PRIVATE-DO-NOT-SYNC-7f3a1c';
    const userDir = ensureUserScopeDir(runtimeDir);
    expect(userDir).toBe(userScopeDir(runtimeDir));
    await mkdir(join(userDir, 'memories'), { recursive: true });
    await writeFile(
      join(userDir, 'memories', 'private-note.md'),
      `# private\n\n${MARKER}\n`,
      'utf8',
    );

    // Run a full session through the spool, push enabled.
    const spool = new Spool({ runtimeDir, brainDir: repo, push: true });
    await spool.handle(ev('sess-user-sep', 'session_start', {}));
    await spool.handle(
      ev('sess-user-sep', 'tool_use', { kind: 'edit', path: 'src/a.ts' }),
    );
    await spool.handle(
      ev('sess-user-sep', 'session_end', {
        outcome: 'committed',
        duration_s: 10,
        turns: 2,
        commit_shas: ['abc1234'],
      }),
    );

    // The record itself made it to the branch and the remote.
    const stored = git(
      ['show', `${SESSIONS_BRANCH}:sessions/sess-user-sep.jsonl`],
      repo,
    );
    expect(stored).toContain('session_end');

    // Git-object-level assertion, on BOTH repos: no reachable object —
    // commit, tree, or blob — names a user/ path or carries the marker.
    for (const objectStore of [repo, remote]) {
      const objects = git(['rev-list', '--objects', '--all'], objectStore)
        .split('\n')
        .filter((line) => line.length > 0);
      for (const line of objects) {
        const [sha, ...pathParts] = line.split(' ');
        const path = pathParts.join(' ');
        expect(path, `object path in ${objectStore}`).not.toMatch(/\buser\//);
        const content = execFileSync('git', ['cat-file', '-p', sha as string], {
          cwd: objectStore,
          encoding: 'utf8',
        });
        expect(content, `object ${sha} in ${objectStore}`).not.toContain(
          MARKER,
        );
      }
    }

    // And the private file is still where it belongs, untouched.
    const kept = await readFile(
      join(userDir, 'memories', 'private-note.md'),
      'utf8',
    );
    expect(kept).toContain(MARKER);
  });
});
