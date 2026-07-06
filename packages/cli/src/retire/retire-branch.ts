import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  EnvironmentError,
  serializeMemoryFile,
  type Memory,
} from '@teambrain/core';

// M8.1 retirement (C1: "git mv to retired/ + status: retired in the same PR").
// Mirrors the init/proposals branch writers: a throwaway git worktree off the
// default branch, so main is never touched (principle 4). The moved file keeps
// its `<id>-<slug>.md` name under retired/ and flips status to retired.

export const RETIRE_BRANCH_PREFIX = 'teambrain/retire-';

export interface RetireBranchResult {
  branch: string;
  commit: string;
  /** Repo-relative source path under .teambrain (in memories/). */
  from: string;
  /** Repo-relative destination path under .teambrain (in retired/). */
  to: string;
  base: string;
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new EnvironmentError(
      `git ${args.join(' ')} failed: ${stderr.trim() || (err as Error).message}`,
      { cause: err },
    );
  }
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function resolveBaseRef(repoRoot: string): string {
  for (const branch of ['main', 'master']) {
    if (
      tryGit(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot) !==
      null
    ) {
      return branch;
    }
  }
  return 'HEAD';
}

export interface RetireBranchParams {
  id: string;
  reason: string;
  /** Repo-relative path of the active memory under .teambrain (memories/…). */
  relPath: string;
  /** The parsed memory (frontmatter + body); status is flipped to retired. */
  memory: Memory;
}

/** Writes the retirement onto a fresh branch; leaves the working tree clean. */
export function writeRetireBranch(
  repoRoot: string,
  params: RetireBranchParams,
): RetireBranchResult {
  const branch = `${RETIRE_BRANCH_PREFIX}${params.id}`;
  if (tryGit(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot)) {
    throw new EnvironmentError(
      `branch ${branch} already exists — merge or delete it before retrying`,
    );
  }
  const base = resolveBaseRef(repoRoot);
  const toRel = join('retired', basename(params.relPath));

  const scratchRoot = mkdtempSync(join(tmpdir(), 'teambrain-retire-'));
  const worktreeDir = join(scratchRoot, 'worktree');
  let branchCreated = false;
  try {
    git(['worktree', 'add', worktreeDir, '-b', branch, base], repoRoot);
    branchCreated = true;

    const brainDir = join(worktreeDir, '.teambrain');
    const source = join(brainDir, params.relPath);
    const dest = join(brainDir, toRel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      serializeMemoryFile({ ...params.memory, status: 'retired' }),
      'utf8',
    );
    rmSync(source, { force: true });

    git(['add', '.teambrain'], worktreeDir);
    git(
      [
        'commit',
        '-m',
        `chore(teambrain): retire ${params.id} — ${params.reason}`,
      ],
      worktreeDir,
    );
    const commit = git(['rev-parse', 'HEAD'], worktreeDir);
    return {
      branch,
      commit,
      from: join('.teambrain', params.relPath),
      to: join('.teambrain', toRel),
      base,
    };
  } catch (err) {
    if (branchCreated) {
      tryGit(['worktree', 'remove', '--force', worktreeDir], repoRoot);
      tryGit(['branch', '-D', branch], repoRoot);
    }
    throw err;
  } finally {
    tryGit(['worktree', 'remove', '--force', worktreeDir], repoRoot);
    tryGit(['worktree', 'prune'], repoRoot);
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
