import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UserError,
  exitCodeForError,
  memoryPath,
  parseBrainConfig,
} from '@teambrain/core';
import {
  anthropicProvider,
  distill,
  type DistillOutcome,
  type EmbedFn,
  type Provider,
  type PullRequestSource,
  type SessionSource,
} from '@teambrain/distill';
import {
  HashingEmbedder,
  defaultModelsDir,
  tryCreateFastEmbedEmbedder,
} from '@teambrain/index';
import { writeProposalsBranch } from './proposals-branch.js';

// M6.4 CLI. `tb distill` runs the full pipeline (collect → cluster → draft →
// dedup → gate); `--dry-run` prints the would-be PR with no git side effects.
// A real run writes the proposals branch and opens a PR via `gh`. Internals are
// injectable so the dry-run path is testable offline (fake provider + fixtures).

export interface DistillCommandResult {
  exitCode: 0 | 1 | 2;
  output: string;
}

export interface DistillCommandOptions {
  dryRun?: boolean;
  /** Overrides for offline tests; production builds the real ones. */
  provider?: Provider;
  embed?: EmbedFn;
  sessions?: SessionSource;
  prs?: PullRequestSource;
  brainDir?: string;
  now?: Date;
  newId?: () => string;
}

function git(args: string[], cwd: string): string | null {
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

function resolveRepoRoot(repoDir: string): string {
  const root = git(['rev-parse', '--show-toplevel'], repoDir);
  if (root === null) {
    throw new UserError(`${repoDir} is not a git repository`);
  }
  return root;
}

/** The real embedder: bge-small if available, else lexical-only (principle 2). */
async function resolveEmbedder(): Promise<EmbedFn> {
  const embedder =
    (await tryCreateFastEmbedEmbedder({ modelsDir: defaultModelsDir() })) ??
    new HashingEmbedder();
  return (texts) => embedder.embedDocs(texts);
}

function dateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function renderDryRun(outcome: DistillOutcome): string {
  const lines = [
    `tb distill --dry-run: ${outcome.clusters} cluster(s), ` +
      `${outcome.discardedDrafts} discarded draft(s), ` +
      `${outcome.droppedDuplicates} duplicate(s) dropped, ` +
      `${outcome.proposals.length} proposal(s).`,
    '',
    'Would create these files:',
    ...outcome.proposals.map((p) => `  + .teambrain/${memoryPath(p.memory)}`),
    '',
    '--- PR body ---',
    outcome.prBody.trimEnd(),
  ];
  return lines.join('\n') + '\n';
}

/** Pushes the branch and opens a PR via `gh`; degrades to printed instructions. */
function tryOpenPullRequest(
  repoRoot: string,
  branch: string,
  prBody: string,
): string {
  const pushed = git(['push', '-u', 'origin', branch], repoRoot);
  if (pushed === null) {
    return (
      `  branch ${branch} is local only (git push failed). ` +
      `Push it and open a PR manually.`
    );
  }
  const scratch = mkdtempSync(join(tmpdir(), 'teambrain-pr-'));
  const bodyFile = join(scratch, 'body.md');
  try {
    writeFileSync(bodyFile, prBody, 'utf8');
    const url = git0(
      [
        'pr',
        'create',
        '--head',
        branch,
        '--title',
        'TeamBrain: proposed memories',
        '--body-file',
        bodyFile,
      ],
      repoRoot,
    );
    return url === null
      ? `  branch ${branch} pushed; \`gh pr create\` unavailable — open a PR manually.`
      : `  opened PR: ${url}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Runs `gh` (not git); returns stdout or null on any failure. */
function git0(args: string[], cwd: string): string | null {
  try {
    return execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export async function runDistillCommand(
  repoDir: string,
  options: DistillCommandOptions = {},
): Promise<DistillCommandResult> {
  let repoRoot: string;
  try {
    repoRoot = resolveRepoRoot(repoDir);
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as 0 | 1 | 2,
      output: `tb distill: ${(err as Error).message}\n`,
    };
  }

  const brainDir = options.brainDir ?? join(repoRoot, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: 1,
      output: `tb distill: no ${brainDir} — run \`tb init\` first\n`,
    };
  }

  // Pin the model from brain.yaml when present (CONTRACTS C5).
  let model: string | undefined;
  const brainYaml = join(brainDir, 'brain.yaml');
  if (existsSync(brainYaml)) {
    const config = parseBrainConfig(readFileSync(brainYaml, 'utf8'));
    model = config.distill?.model;
  }

  const provider =
    options.provider ?? anthropicProvider(model === undefined ? {} : { model });
  const embed = options.embed ?? (await resolveEmbedder());

  const outcome = await distill({
    repoRoot,
    brainDir,
    provider,
    embed,
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    ...(options.prs === undefined ? {} : { prs: options.prs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.newId === undefined ? {} : { newId: options.newId }),
  });

  if (options.dryRun === true) {
    return { exitCode: 0, output: renderDryRun(outcome) };
  }

  if (outcome.proposals.length === 0) {
    return { exitCode: 0, output: 'tb distill: no proposals this run.\n' };
  }

  const branch = `teambrain/proposals-${dateStamp(options.now ?? new Date())}`;
  const result = writeProposalsBranch(repoRoot, outcome.proposals, {
    branch,
    nextWatermark: outcome.nextWatermark,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const prNote = tryOpenPullRequest(repoRoot, branch, outcome.prBody);

  const output =
    `tb distill: wrote ${result.fileCount} memory file(s) to branch ` +
    `${result.branch} (from ${result.base}).\n${prNote}\n`;
  return { exitCode: 0, output };
}
