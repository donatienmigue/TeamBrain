import { execFileSync } from 'node:child_process';
import type { PullRequest } from './types.js';

// M6.1 merged-PR metadata via `gh pr list --json` (GitHub only; the GitLab
// driver is deferred — see the DEVLOG). PR metadata links commits to changed
// paths so clusters can carry richer commit evidence. The exec is injectable
// so tests never shell out or touch the network.

export interface PullRequestSource {
  readMergedPRs(): PullRequest[];
}

export type ExecFn = (command: string, args: string[]) => string;

const defaultExec: ExecFn = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });

interface GhFile {
  path?: string;
}
interface GhCommit {
  oid?: string;
}
interface GhPr {
  number?: number;
  title?: string;
  files?: GhFile[];
  commits?: GhCommit[];
  mergedAt?: string;
}

/** Normalizes one `gh` PR record into our PullRequest shape. */
function toPullRequest(pr: GhPr): PullRequest | null {
  if (typeof pr.number !== 'number') return null;
  return {
    number: pr.number,
    title: pr.title ?? '',
    files: (pr.files ?? [])
      .map((file) => file.path)
      .filter((path): path is string => typeof path === 'string'),
    commits: (pr.commits ?? [])
      .map((commit) => commit.oid)
      .filter((oid): oid is string => typeof oid === 'string'),
    ...(pr.mergedAt === undefined ? {} : { mergedAt: pr.mergedAt }),
  };
}

/**
 * A PullRequestSource backed by the GitHub CLI. Failures (no `gh`, not
 * authenticated, no remote) degrade to an empty list — merged-PR metadata
 * enriches clusters but is not required to produce them (principle 2).
 */
export function ghPullRequestSource(
  repoRoot: string,
  options: { exec?: ExecFn; limit?: number } = {},
): PullRequestSource {
  const exec = options.exec ?? defaultExec;
  const limit = options.limit ?? 100;
  return {
    readMergedPRs(): PullRequest[] {
      let raw: string;
      try {
        raw = exec('gh', [
          'pr',
          'list',
          '--repo',
          repoRoot,
          '--state',
          'merged',
          '--limit',
          String(limit),
          '--json',
          'number,title,files,commits,mergedAt',
        ]);
      } catch {
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((pr) => toPullRequest(pr as GhPr))
        .filter((pr): pr is PullRequest => pr !== null);
    },
  };
}
