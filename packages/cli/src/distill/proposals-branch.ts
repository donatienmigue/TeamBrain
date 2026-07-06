import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  EnvironmentError,
  serializeMemoryFile,
  type Memory,
} from '@teambrain/core';
import { writeDistillWatermark, type Proposal } from '@teambrain/distill';

// M6.4 output: write the distilled proposals onto a fresh
// `teambrain/proposals-<date>` branch via a temporary git worktree — the same
// never-touch-main discipline as `tb init` (principle 4). The base branch
// already carries `.teambrain/`; we add one file per candidate and advance the
// distill watermark so merging the PR both lands the memories and moves the
// run forward.

export interface ProposalsBranchResult {
  branch: string;
  commit: string;
  fileCount: number;
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

export interface WriteProposalsBranchOptions {
  branch: string;
  /** Watermark to persist in the branch's brain.yaml (skip when null). */
  nextWatermark: string | null;
  now?: Date;
}

/** Writes proposals + advanced watermark onto a new branch; leaves main clean. */
export function writeProposalsBranch(
  repoRoot: string,
  proposals: Proposal[],
  options: WriteProposalsBranchOptions,
): ProposalsBranchResult {
  const { branch } = options;
  if (tryGit(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot)) {
    throw new EnvironmentError(
      `branch ${branch} already exists — delete it or wait for the next run`,
    );
  }
  const base = resolveBaseRef(repoRoot);

  const scratchRoot = mkdtempSync(join(tmpdir(), 'teambrain-distill-'));
  const worktreeDir = join(scratchRoot, 'worktree');
  let branchCreated = false;
  try {
    git(['worktree', 'add', worktreeDir, '-b', branch, base], repoRoot);
    branchCreated = true;

    const brainDir = join(worktreeDir, '.teambrain');
    for (const proposal of proposals) {
      const absolute = join(brainDir, proposal.path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(
        absolute,
        serializeMemoryFile(proposal.memory as Memory),
        'utf8',
      );
    }
    if (options.nextWatermark !== null) {
      writeDistillWatermark(
        brainDir,
        options.nextWatermark,
        options.now ?? new Date(),
      );
    }

    git(['add', '.teambrain'], worktreeDir);
    git(
      [
        'commit',
        '-m',
        `chore(teambrain): distill ${proposals.length} candidate ` +
          `${proposals.length === 1 ? 'memory' : 'memories'}`,
      ],
      worktreeDir,
    );
    const commit = git(['rev-parse', 'HEAD'], worktreeDir);
    return { branch, commit, fileCount: proposals.length, base };
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
