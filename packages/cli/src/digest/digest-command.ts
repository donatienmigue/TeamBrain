import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseMemoryFile, UserError, exitCodeForError } from '@teambrain/core';
import { gitSessionSource, type SessionSource } from '@teambrain/distill';
import type { SessionEvent } from '@teambrain/core';
import {
  aggregateDigest,
  type DigestMemory,
  type DigestReport,
  type RulesFile,
} from './aggregate.js';
import { postDigest, renderSlackMessage, type SlackMessage } from './slack.js';

// M7.1 `tb digest`: the weekly CI entrypoint. Reads people-free aggregates from
// the brain + sessions branch, renders a Slack payload, and posts it (or, with
// --dry-run / no webhook, prints it). All heavy inputs are injectable so the
// aggregation is tested offline.

export interface DigestCommandResult {
  exitCode: 0 | 1 | 2;
  output: string;
}

export interface DigestCommandOptions {
  dryRun?: boolean;
  /** Slack incoming-webhook URL; defaults to $TEAMBRAIN_SLACK_WEBHOOK. */
  webhookUrl?: string;
  /** Override the sessions source (tests). */
  sessions?: SessionSource;
  /** Open-proposal-PR count; defaults to a best-effort `gh` query. */
  proposedCount?: number;
  brainDir?: string;
  now?: Date;
  /** Override the Slack poster (tests). */
  post?: (url: string, message: SlackMessage) => Promise<boolean>;
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

function* walkMarkdown(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMarkdown(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

function loadActiveMemories(brainDir: string): DigestMemory[] {
  const memories: DigestMemory[] = [];
  for (const file of walkMarkdown(join(brainDir, 'memories'))) {
    try {
      const { frontmatter } = parseMemoryFile(readFileSync(file, 'utf8'));
      if (frontmatter.status !== 'active') continue;
      memories.push({
        id: frontmatter.id,
        title: frontmatter.title,
        created: frontmatter.created,
      });
    } catch {
      continue;
    }
  }
  return memories;
}

function countRetired(brainDir: string): number {
  return [...walkMarkdown(join(brainDir, 'retired'))].length;
}

/** Reads the rules-drift baseline hashes from brain.yaml's state block. */
function readRulesBaseline(brainDir: string): Record<string, string> {
  const path = join(brainDir, 'brain.yaml');
  if (!existsSync(path)) return {};
  const parsed = parseYaml(readFileSync(path, 'utf8')) as
    { state?: { digest?: { rules_hashes?: unknown } } } | null | undefined;
  const hashes = parsed?.state?.digest?.rules_hashes;
  if (hashes === null || typeof hashes !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [file, hash] of Object.entries(
    hashes as Record<string, unknown>,
  )) {
    if (typeof hash === 'string') result[file] = hash;
  }
  return result;
}

// The tool-local rules files whose drift the digest tracks (Tech Brief §4.7).
const RULES_CANDIDATES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules'];

function collectRules(
  repoRoot: string,
  baseline: Record<string, string>,
): RulesFile[] {
  const files: string[] = [...RULES_CANDIDATES];
  const cursorRules = join(repoRoot, '.cursor', 'rules');
  if (existsSync(cursorRules)) {
    for (const name of readdirSync(cursorRules).sort()) {
      if (name.endsWith('.mdc')) files.push(join('.cursor', 'rules', name));
    }
  }
  const rules: RulesFile[] = [];
  for (const rel of files) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
    rules.push({ file: rel, hash, baselineHash: baseline[rel] ?? null });
  }
  return rules;
}

function ghProposedCount(repoRoot: string): number {
  try {
    const out = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--search',
        'head:teambrain/proposals-',
        '--json',
        'number',
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function eventsFrom(source: SessionSource): SessionEvent[] {
  return source.readNewRecords(null).flatMap((record) => record.events);
}

export async function runDigestCommand(
  repoDir: string,
  options: DigestCommandOptions = {},
): Promise<DigestCommandResult> {
  let repoRoot: string;
  const root = git(['rev-parse', '--show-toplevel'], repoDir);
  try {
    if (root === null)
      throw new UserError(`${repoDir} is not a git repository`);
    repoRoot = root;
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as 0 | 1 | 2,
      output: `tb digest: ${(err as Error).message}\n`,
    };
  }

  const brainDir = options.brainDir ?? join(repoRoot, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: 1,
      output: `tb digest: no ${brainDir} — run \`tb init\` first\n`,
    };
  }

  const sessions = options.sessions ?? gitSessionSource(repoRoot);
  const report: DigestReport = aggregateDigest({
    events: eventsFrom(sessions),
    active: loadActiveMemories(brainDir),
    retiredCount: countRetired(brainDir),
    proposedCount: options.proposedCount ?? ghProposedCount(repoRoot),
    rules: collectRules(repoRoot, readRulesBaseline(brainDir)),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const message = renderSlackMessage(report);
  const webhookUrl =
    options.webhookUrl ?? process.env['TEAMBRAIN_SLACK_WEBHOOK'];

  if (
    options.dryRun === true ||
    webhookUrl === undefined ||
    webhookUrl === ''
  ) {
    const output =
      `${JSON.stringify({ report, message }, null, 2)}\n` +
      (webhookUrl === undefined || webhookUrl === ''
        ? 'tb digest: no webhook configured ($TEAMBRAIN_SLACK_WEBHOOK); printed above.\n'
        : 'tb digest --dry-run: not posted.\n');
    return { exitCode: 0, output };
  }

  const post = options.post ?? postDigest;
  const ok = await post(webhookUrl, message);
  return {
    exitCode: 0,
    output: ok
      ? 'tb digest: posted the weekly digest to Slack.\n'
      : 'tb digest: Slack post failed; digest not delivered (records retained).\n',
  };
}
