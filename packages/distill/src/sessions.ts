import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { parseSessionEventLine, type SessionEvent } from '@teambrain/core';
import type { SessionRecord } from './types.js';

// M6.1 session collection. Reads redacted records off the never-merged
// `teambrain/sessions` branch, restricted to what is new since the watermark
// (a git diff), so a CI run only distills fresh sessions.

export const SESSIONS_BRANCH = 'teambrain/sessions';

export interface SessionSource {
  /** The branch tip SHA (the next watermark), or null if the branch is absent. */
  head(): string | null;
  /** Records added since `sinceWatermark` (all records when it is null). */
  readNewRecords(sinceWatermark: string | null): SessionRecord[];
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function isSessionFile(path: string): boolean {
  return /^sessions\/.+\.jsonl$/.test(path);
}

function parseRecord(sid: string, content: string): SessionRecord {
  const events: SessionEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    // Records are machine-written and schema-valid; a line that no longer
    // parses is corruption we skip rather than fail the whole CI run on.
    try {
      events.push(parseSessionEventLine(line));
    } catch {
      continue;
    }
  }
  const commitShas = [
    ...new Set(
      events.flatMap((event) =>
        event.ev === 'session_end'
          ? (event.data as { commit_shas: string[] }).commit_shas
          : [],
      ),
    ),
  ];
  const first = events[0];
  return {
    sid,
    events,
    commitShas,
    ...(first === undefined ? {} : { repo: first.repo, branch: first.branch }),
  };
}

/** A SessionSource backed by a local clone's `teambrain/sessions` branch. */
export function gitSessionSource(
  repoRoot: string,
  branch: string = SESSIONS_BRANCH,
): SessionSource {
  const head = (): string | null =>
    tryGit(['rev-parse', '--verify', `${branch}^{commit}`], repoRoot);

  return {
    head,
    readNewRecords(sinceWatermark: string | null): SessionRecord[] {
      const tip = head();
      if (tip === null) return [];

      const watermarkValid =
        sinceWatermark !== null &&
        tryGit(
          ['rev-parse', '--verify', `${sinceWatermark}^{commit}`],
          repoRoot,
        ) !== null;
      const listing = watermarkValid
        ? tryGit(
            [
              'diff',
              '--name-only',
              '--diff-filter=AMR',
              `${sinceWatermark}..${tip}`,
              '--',
              'sessions/',
            ],
            repoRoot,
          )
        : tryGit(
            ['ls-tree', '-r', '--name-only', tip, '--', 'sessions/'],
            repoRoot,
          );

      const files = (listing ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(isSessionFile)
        .sort();

      const records: SessionRecord[] = [];
      for (const file of files) {
        const content = tryGit(['show', `${tip}:${file}`], repoRoot);
        if (content === null) continue;
        records.push(parseRecord(basename(file, '.jsonl'), content));
      }
      return records;
    },
  };
}
