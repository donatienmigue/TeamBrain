import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseBrainConfig } from '@teambrain/core';
import { buildDenyMatcher, type RedactionLevel } from '@teambrain/redact';
import type { HookContext } from './map.js';

// Builds the per-invocation HookContext from the environment: git repo/branch,
// the brain's redaction level + deny-globs, and .gitignore. All git/fs access
// is best-effort — a hook must never fail the session (principle 2), so every
// lookup has a safe fallback.

function tryGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** owner/repo from the origin remote, else the repo directory name. */
function resolveRepo(cwd: string): string {
  const remote = tryGit(['remote', 'get-url', 'origin'], cwd);
  const match = remote?.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (match?.[1] !== undefined) return match[1];
  const root = tryGit(['rev-parse', '--show-toplevel'], cwd) ?? cwd;
  return basename(root);
}

/** Commits on HEAD not yet on the upstream/main — a proxy for session work. */
function sessionCommits(cwd: string): string[] {
  const range =
    tryGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      cwd,
    ) !== null
      ? '@{upstream}..HEAD'
      : tryGit(['rev-parse', '--verify', 'main'], cwd) !== null
        ? 'main..HEAD'
        : null;
  if (range === null) return [];
  const log = tryGit(['log', '--format=%H', range], cwd);
  return log === null || log.length === 0 ? [] : log.split('\n');
}

function readDenyGlobs(brainDir: string): string[] {
  const patterns: string[] = [];
  const configPath = join(brainDir, 'brain.yaml');
  if (existsSync(configPath)) {
    try {
      const config = parseBrainConfig(readFileSync(configPath, 'utf8'));
      const redaction = config.redaction as Record<string, unknown>;
      const deny = redaction['deny_globs'];
      if (Array.isArray(deny)) {
        patterns.push(
          ...deny.filter((g): g is string => typeof g === 'string'),
        );
      }
    } catch {
      /* malformed brain.yaml → no extra deny globs */
    }
  }
  return patterns;
}

export interface BuildHookContextOptions {
  cwd: string;
  sid: string;
  now?: () => Date;
  tool?: string;
  model?: string;
  session?: HookContext['session'];
}

export function buildHookContext(
  options: BuildHookContextOptions,
): HookContext {
  const { cwd } = options;
  const root = tryGit(['rev-parse', '--show-toplevel'], cwd) ?? cwd;
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) ?? 'HEAD';
  const brainDir = join(root, '.teambrain');

  let level: RedactionLevel = 'strict';
  const configPath = join(brainDir, 'brain.yaml');
  if (existsSync(configPath)) {
    try {
      level = parseBrainConfig(readFileSync(configPath, 'utf8')).redaction
        .level;
    } catch {
      /* keep strict on a malformed config — fail safe toward more redaction */
    }
  }

  const gitignorePath = join(root, '.gitignore');
  const gitignore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8').split('\n')
    : [];
  const deny = buildDenyMatcher([...gitignore, ...readDenyGlobs(brainDir)]);

  return {
    sid: options.sid,
    repo: resolveRepo(cwd),
    branch,
    tool: options.tool ?? 'claude-code',
    model: options.model ?? process.env['TEAMBRAIN_MODEL'] ?? 'unknown',
    redactionLevel: level,
    now: options.now ?? ((): Date => new Date()),
    deny,
    session: options.session ?? { commitShas: sessionCommits(cwd) },
  };
}
