import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  UserError,
  exitCodeForError,
  parseMemoryFile,
  type Memory,
} from '@teambrain/core';
import { writeRetireBranch } from './retire-branch.js';

// M8.1 `tb retire <id> <reason>`: opens a retirement PR moving the memory to
// retired/ with status: retired. Never writes to main — a throwaway worktree
// builds the branch; the PR is best-effort via gh.

export interface RetireCommandResult {
  exitCode: 0 | 1 | 2;
  output: string;
}

export interface RetireCommandOptions {
  brainDir?: string;
  /** Override PR opening (tests); default pushes + `gh pr create`. */
  openPr?: boolean;
}

function gitOut(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function* walkMarkdown(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMarkdown(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

interface Found {
  /** Path relative to .teambrain (e.g. memories/learnings/<id>-slug.md). */
  relPath: string;
  memory: Memory;
}

/** Finds the active memory with `id` under .teambrain/memories. */
function findMemory(brainDir: string, id: string): Found | null {
  for (const file of walkMarkdown(join(brainDir, 'memories'))) {
    try {
      const { frontmatter, body } = parseMemoryFile(readFileSync(file, 'utf8'));
      if (frontmatter.id !== id) continue;
      return {
        relPath: relative(brainDir, file)
          .split(/[\\/]+/)
          .join('/'),
        memory: { ...frontmatter, body },
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Pushes the branch and opens a retirement PR via `gh`; degrades to a note. */
function tryOpenPullRequest(
  repoRoot: string,
  branch: string,
  id: string,
  reason: string,
): string {
  if (gitOut(['push', '-u', 'origin', branch], repoRoot) === null) {
    return `  branch ${branch} is local only (git push failed); open a PR manually.`;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'teambrain-retire-pr-'));
  const bodyFile = join(scratch, 'body.md');
  try {
    writeFileSync(bodyFile, `Retire \`${id}\`.\n\nReason: ${reason}\n`, 'utf8');
    let url: string | null = null;
    try {
      url = execFileSync(
        'gh',
        [
          'pr',
          'create',
          '--head',
          branch,
          '--title',
          `Retire ${id}`,
          '--body-file',
          bodyFile,
        ],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    } catch {
      url = null;
    }
    return url === null
      ? `  branch ${branch} pushed; open a retirement PR manually.`
      : `  opened PR: ${url}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function runRetireCommand(
  repoDir: string,
  id: string,
  reason: string,
  options: RetireCommandOptions = {},
): RetireCommandResult {
  let repoRoot: string;
  const root = gitOut(['rev-parse', '--show-toplevel'], repoDir);
  try {
    if (root === null)
      throw new UserError(`${repoDir} is not a git repository`);
    if (reason.trim().length === 0) {
      throw new UserError('a retirement reason is required');
    }
    repoRoot = root;
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as 0 | 1 | 2,
      output: `tb retire: ${(err as Error).message}\n`,
    };
  }

  const brainDir = options.brainDir ?? join(repoRoot, '.teambrain');
  if (!existsSync(brainDir)) {
    return { exitCode: 1, output: `tb retire: no ${brainDir}\n` };
  }

  const found = findMemory(brainDir, id);
  if (found === null) {
    return {
      exitCode: 1,
      output: `tb retire: no active memory with id ${id}\n`,
    };
  }

  try {
    const result = writeRetireBranch(repoRoot, {
      id,
      reason,
      relPath: found.relPath,
      memory: found.memory,
    });
    let output =
      `tb retire: moved ${result.from} → ${result.to} on branch ` +
      `${result.branch} (from ${result.base}).\n`;
    if (options.openPr !== false) {
      output += tryOpenPullRequest(repoRoot, result.branch, id, reason) + '\n';
    }
    return { exitCode: 0, output };
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as 0 | 1 | 2,
      output: `tb retire: ${(err as Error).message}\n`,
    };
  }
}
