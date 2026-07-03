import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { lintBrain, parseMemoryFile } from '@teambrain/core';
import { scanRepo } from './scan.js';
import { runInitCommand } from './init-command.js';
import { INIT_BRANCH } from './branch.js';

const REPOS_DIR = fileURLToPath(
  new URL('../../../../testdata/repos', import.meta.url),
);

const tempDirs: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teambrain-m2-'));
  tempDirs.push(dir);
  return dir;
}

/** Copies a fixture repo into a fresh git repo with one commit on main. */
function makeGitRepo(fixtureName: string): string {
  const dir = makeTempDir();
  cpSync(join(REPOS_DIR, fixtureName), dir, { recursive: true });
  git(['init', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.invalid'], dir);
  git(['config', 'user.name', 'M2 Integration Test'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-m', 'fixture baseline'], dir);
  return dir;
}

/** Checks the init branch out into a scratch worktree and returns it. */
function checkoutInitBranch(repoDir: string): string {
  const worktree = join(makeTempDir(), 'inspect');
  git(['worktree', 'add', worktree, INIT_BRANCH], repoDir);
  return worktree;
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const EXPECTED: Record<
  string,
  { total: number; byDir: Record<string, number> }
> = {
  'claude-md-only': { total: 4, byDir: { conventions: 4 } },
  'cursor-heavy': { total: 7, byDir: { conventions: 6, map: 1 } },
  'adr-rich': { total: 5, byDir: { decisions: 4, conventions: 1 } },
};

describe('M2 acceptance: tb init against the fixture repos', () => {
  for (const [fixture, expected] of Object.entries(EXPECTED)) {
    it(`${fixture}: writes a lint-clean brain to ${INIT_BRANCH} without touching main`, async () => {
      const repo = makeGitRepo(fixture);
      const mainShaBefore = git(['rev-parse', 'main'], repo);

      const result = await runInitCommand(repo, { interview: false });
      expect(result.output).toContain('Next steps');
      expect(result.exitCode).toBe(0);

      // Main is untouched: same sha, clean status, no .teambrain, and
      // no leftover worktrees from the writer.
      expect(git(['rev-parse', 'main'], repo)).toBe(mainShaBefore);
      expect(git(['status', '--porcelain'], repo)).toBe('');
      expect(existsSync(join(repo, '.teambrain'))).toBe(false);
      expect(git(['worktree', 'list'], repo).split('\n')).toHaveLength(1);

      // The branch exists, parented on main's tip.
      expect(git(['rev-parse', `${INIT_BRANCH}^`], repo)).toBe(mainShaBefore);

      const brainDir = join(checkoutInitBranch(repo), '.teambrain');
      const report = lintBrain(brainDir);
      expect(report.violations).toEqual([]);
      expect(report.memoryFileCount).toBe(expected.total);

      // Class mapping: file counts per class directory.
      for (const [classDir, count] of Object.entries(expected.byDir)) {
        expect(
          readdirSync(join(brainDir, 'memories', classDir)),
          `${fixture}/${classDir}`,
        ).toHaveLength(count);
      }

      // ≥90% preservation, recomputed from the files actually written.
      const bodiesBySource = new Map<string, string>();
      const ids: string[] = [];
      for (const classDir of readdirSync(join(brainDir, 'memories'))) {
        for (const file of readdirSync(join(brainDir, 'memories', classDir))) {
          const parsed = parseMemoryFile(
            readFileSync(join(brainDir, 'memories', classDir, file), 'utf8'),
          );
          ids.push(parsed.frontmatter.id);
          const source = parsed.frontmatter.tags
            .find((tag) => tag.startsWith('source:'))
            ?.slice('source:'.length);
          expect(source, file).toBeDefined();
          bodiesBySource.set(
            source as string,
            `${bodiesBySource.get(source as string) ?? ''} ${parsed.body}`,
          );
        }
      }
      for (const source of scanRepo(repo)) {
        const bodies = bodiesBySource.get(source.path) ?? '';
        expect(
          jaccard(tokenSet(source.text), tokenSet(bodies)),
          `${fixture}/${source.path}`,
        ).toBeGreaterThanOrEqual(0.9);
      }

      // INDEX.md references every written memory.
      const index = readFileSync(join(brainDir, 'INDEX.md'), 'utf8');
      for (const id of ids) expect(index).toContain(id);
    });
  }

  it('includes interview answers on the branch', async () => {
    const repo = makeGitRepo('claude-md-only');
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    // 3 questions for this fixture; answer the first, skip the rest.
    input.end('api service owns checkout; payments worker owns Stripe\n\n\n');

    const result = await runInitCommand(repo, {
      interview: true,
      io: { input, output },
    });
    expect(result.exitCode).toBe(0);

    const brainDir = join(checkoutInitBranch(repo), '.teambrain');
    const mapFiles = readdirSync(join(brainDir, 'memories', 'map'));
    expect(mapFiles).toHaveLength(1);
    const parsed = parseMemoryFile(
      readFileSync(
        join(brainDir, 'memories', 'map', mapFiles[0] as string),
        'utf8',
      ),
    );
    expect(parsed.frontmatter.tags).toContain('interview');
    expect(parsed.body).toContain('payments worker');
    expect(lintBrain(brainDir).memoryFileCount).toBe(5);
  });

  it('fails cleanly on repos it must not touch', async () => {
    // Not a git repository.
    const plainDir = makeTempDir();
    const notGit = await runInitCommand(plainDir, { interview: false });
    expect(notGit.exitCode).toBe(1);
    expect(notGit.output).toContain('not a git repository');

    // A git repository with no commits.
    const emptyRepo = makeTempDir();
    git(['init', '--initial-branch=main'], emptyRepo);
    const noCommits = await runInitCommand(emptyRepo, { interview: false });
    expect(noCommits.exitCode).toBe(1);
    expect(noCommits.output).toContain('no commits');

    // A repository that already has a .teambrain directory.
    const initialized = makeGitRepo('claude-md-only');
    mkdirSync(join(initialized, '.teambrain'));
    const alreadyInit = await runInitCommand(initialized, { interview: false });
    expect(alreadyInit.exitCode).toBe(1);
    expect(alreadyInit.output).toContain('.teambrain already exists');
  });

  it('refuses to run twice (branch already exists), leaving main clean', async () => {
    const repo = makeGitRepo('adr-rich');
    expect((await runInitCommand(repo, { interview: false })).exitCode).toBe(0);
    const second = await runInitCommand(repo, { interview: false });
    expect(second.exitCode).toBe(1);
    expect(second.output).toContain(`branch ${INIT_BRANCH} already exists`);
    expect(git(['status', '--porcelain'], repo)).toBe('');
  });

  it('reports nothing to import for a repo without agent knowledge', async () => {
    const repo = makeTempDir();
    cpSync(
      join(REPOS_DIR, 'claude-md-only', 'README.md'),
      join(repo, 'README.md'),
    );
    git(['init', '--initial-branch=main'], repo);
    git(['config', 'user.email', 'test@example.invalid'], repo);
    git(['config', 'user.name', 'M2 Integration Test'], repo);
    git(['add', '-A'], repo);
    git(['commit', '-m', 'baseline'], repo);

    const result = await runInitCommand(repo, { interview: false });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('nothing to import');
    expect(git(['status', '--porcelain'], repo)).toBe('');
  });
});
