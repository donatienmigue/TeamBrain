import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionPathTracker, toRepoRelative } from './session-paths.js';

// R16.1 (P1): the daemon's codemap-scoping signal. Path normalization is
// pure; the branch-diff arm runs against a scratch git repo under TMPDIR
// (never the developer's real repo).

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('toRepoRelative', () => {
  const root = 'C:/work/repo';

  it('strips the repo root from absolute paths (either slash style)', () => {
    expect(toRepoRelative('C:/work/repo/src/a.ts', root)).toBe('src/a.ts');
    expect(toRepoRelative('C:\\work\\repo\\src\\a.ts', 'C:\\work\\repo')).toBe(
      'src/a.ts',
    );
    expect(toRepoRelative('/home/dev/repo/src/a.ts', '/home/dev/repo')).toBe(
      'src/a.ts',
    );
  });

  it('rejects absolute paths outside the repo root', () => {
    expect(toRepoRelative('C:/elsewhere/x.ts', root)).toBeNull();
    expect(toRepoRelative('/etc/passwd', '/home/dev/repo')).toBeNull();
  });

  it('passes already-relative paths through, normalized to posix', () => {
    expect(toRepoRelative('src/a.ts', root)).toBe('src/a.ts');
    expect(toRepoRelative('src\\payments\\retry.ts', root)).toBe(
      'src/payments/retry.ts',
    );
  });
});

describe('SessionPathTracker.record', () => {
  it('dedupes, keeps insertion recency, and ages out beyond the cap', () => {
    const tracker = new SessionPathTracker('C:/work/repo', undefined, 3);
    tracker.record('a.ts');
    tracker.record('b.ts');
    tracker.record('a.ts'); // re-touch: moves to newest, no duplicate
    tracker.record('c.ts');
    tracker.record('d.ts'); // cap 3: evicts the oldest (b.ts)
    expect(tracker.paths().sort()).toEqual(['a.ts', 'c.ts', 'd.ts']);
  });

  it('ignores paths that cannot belong to the repo', () => {
    const tracker = new SessionPathTracker('C:/work/repo');
    tracker.record('D:/other/x.ts');
    expect(tracker.paths()).toEqual([]);
  });
});

describe('SessionPathTracker.refreshBranchDiff (scratch git repo)', () => {
  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  }

  function scratchRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tb-session-paths-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    git(dir, 'init', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, 'config', 'user.name', 'test');
    writeFileSync(join(dir, 'base.ts'), 'export const base = 1;\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'base');
    return dir;
  }

  it('collects the branch diff vs the default branch', async () => {
    const repo = scratchRepo();
    git(repo, 'checkout', '-b', 'feature');
    mkdirSync(join(repo, 'src', 'payments'), { recursive: true });
    writeFileSync(
      join(repo, 'src', 'payments', 'retry.ts'),
      'export const r = 1;\n',
    );
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'feature work');

    const tracker = new SessionPathTracker(repo);
    await new Promise<void>((resolve) => tracker.refreshBranchDiff(resolve));
    expect(tracker.paths()).toEqual(['src/payments/retry.ts']);
  });

  it('degrades to no signal outside a git repo (principle 2)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-not-a-repo-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const tracker = new SessionPathTracker(dir);
    await new Promise<void>((resolve) => tracker.refreshBranchDiff(resolve));
    expect(tracker.paths()).toEqual([]);
  });
});
