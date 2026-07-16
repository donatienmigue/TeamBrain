import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeSessionEvent,
  type Logger,
  type SessionEvent,
} from '@teambrain/core';
import { sessionRecordPath, sessionSpoolDir } from './paths.js';

// M5.3 spool: the daemon's durable landing zone for redacted session events.
// Events are already redacted by the hook (principle 3) before they reach
// here; the daemon only persists and, on session_end, publishes the record to
// the never-merged `teambrain/sessions` branch. Git is the transport; the
// local spool is a bounded cache (200MB, oldest-first eviction).

export const SESSIONS_BRANCH = 'teambrain/sessions';
export const DEFAULT_SPOOL_CAP_BYTES = 200 * 1024 * 1024;

// Well-known SHA-1 of the empty git tree; the seed for the orphan branch.
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

interface GitOptions {
  /** Extra env (e.g. GIT_INDEX_FILE) for plumbing against a temporary index. */
  env?: NodeJS.ProcessEnv;
}

function git(args: string[], cwd: string, options: GitOptions = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // The spool runs inside the console-less detached daemon: without
    // windowsHide each git call flashes a console window on Windows.
    windowsHide: true,
    ...(options.env === undefined ? {} : { env: options.env }),
  }).trim();
}

function tryGit(
  args: string[],
  cwd: string,
  options: GitOptions = {},
): string | null {
  try {
    return git(args, cwd, options);
  } catch {
    return null;
  }
}

export interface SpoolOptions {
  runtimeDir: string;
  /** The repo brain dir; its repo hosts the sessions branch. */
  brainDir: string;
  logger?: Logger;
  /** Push the sessions branch after commit (best-effort). Default true. */
  push?: boolean;
  /** Spool size cap in bytes before oldest-first eviction. */
  maxBytes?: number;
}

export class Spool {
  private readonly runtimeDir: string;
  private readonly brainDir: string;
  private readonly logger: Logger | undefined;
  private readonly push: boolean;
  private readonly maxBytes: number;

  constructor(options: SpoolOptions) {
    this.runtimeDir = options.runtimeDir;
    this.brainDir = options.brainDir;
    this.logger = options.logger;
    this.push = options.push ?? true;
    this.maxBytes = options.maxBytes ?? DEFAULT_SPOOL_CAP_BYTES;
  }

  /** Persist one event; on session_end publish the record to the branch. */
  async handle(event: SessionEvent): Promise<void> {
    this.append(event);
    this.enforceCap();
    if (event.ev === 'session_end') {
      await this.commitSession(event.sid);
    }
  }

  private append(event: SessionEvent): void {
    const dir = sessionSpoolDir(this.runtimeDir);
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      sessionRecordPath(this.runtimeDir, event.sid),
      `${serializeSessionEvent(event)}\n`,
      'utf8',
    );
  }

  /** Session record files, oldest first, excluding the feedback log. */
  private recordFiles(): Array<{
    path: string;
    size: number;
    mtimeMs: number;
  }> {
    const dir = sessionSpoolDir(this.runtimeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl') && name !== 'feedback.jsonl')
      .map((name) => {
        const path = join(dir, name);
        const stat = statSync(path);
        return { path, size: stat.size, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  private enforceCap(): void {
    const files = this.recordFiles();
    let total = files.reduce((sum, file) => sum + file.size, 0);
    let index = 0;
    while (total > this.maxBytes && index < files.length) {
      const victim = files[index] as (typeof files)[number];
      try {
        rmSync(victim.path);
        total -= victim.size;
        this.logger?.warn('spool cap exceeded; evicted oldest session record', {
          path: victim.path,
          freed_bytes: victim.size,
        });
      } catch {
        /* already gone */
      }
      index++;
    }
  }

  /**
   * Commits `<sid>.jsonl` onto the never-merged `teambrain/sessions` branch,
   * then pushes best-effort. Any failure keeps the record local (principle 2):
   * the spool is the durable copy until git catches up.
   */
  async commitSession(sid: string): Promise<void> {
    const recordPath = sessionRecordPath(this.runtimeDir, sid);
    if (!existsSync(recordPath)) return;
    const repoRoot = tryGit(['rev-parse', '--show-toplevel'], this.brainDir);
    if (repoRoot === null) {
      this.logger?.debug('no git repo for sessions branch; record kept local', {
        sid,
      });
      return;
    }
    try {
      this.ensureSessionsBranch(repoRoot);
      this.commitRecord(repoRoot, sid, recordPath);
    } catch (err) {
      this.logger?.debug('sessions-branch commit failed; record kept local', {
        sid,
        reason: (err as Error).message,
      });
    }
    return Promise.resolve();
  }

  private ensureSessionsBranch(repoRoot: string): void {
    if (
      tryGit(
        ['rev-parse', '--verify', `refs/heads/${SESSIONS_BRANCH}`],
        repoRoot,
      ) !== null
    ) {
      return;
    }
    // Seed an orphan branch: an empty-tree commit with no parent, so the
    // sessions branch never carries the project's file tree. The empty tree is
    // a well-known object git always knows, so commit-tree needs no mktree.
    const commit = git(
      ['commit-tree', EMPTY_TREE_SHA, '-m', 'init teambrain/sessions'],
      repoRoot,
    );
    git(['branch', SESSIONS_BRANCH, commit], repoRoot);
  }

  /**
   * Adds `<sid>.jsonl` to the sessions branch with pure git plumbing — no
   * working-tree checkout. The record blob is written with `hash-object`, the
   * branch's current tree is read into a throwaway index, the new path is
   * staged, and a commit is fast-forwarded onto the branch via `update-ref`
   * (compare-and-set against the old tip). Avoiding `git worktree` keeps this
   * cheap and free of the disk contention that made the path slow under load.
   */
  private commitRecord(
    repoRoot: string,
    sid: string,
    recordPath: string,
  ): void {
    const tip = git(
      ['rev-parse', '--verify', `refs/heads/${SESSIONS_BRANCH}`],
      repoRoot,
    );
    const tipTree = git(['rev-parse', '--verify', `${tip}^{tree}`], repoRoot);
    const blob = git(['hash-object', '-w', recordPath], repoRoot);

    const scratch = mkdtempSync(join(tmpdir(), 'teambrain-sessions-'));
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
    try {
      git(['read-tree', tipTree], repoRoot, { env });
      git(
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '100644',
          blob,
          `sessions/${sid}.jsonl`,
        ],
        repoRoot,
        { env },
      );
      const newTree = git(['write-tree'], repoRoot, { env });
      // Idempotent: re-handling the same session_end changes nothing.
      if (newTree === tipTree) return;

      const commit = git(
        [
          'commit-tree',
          newTree,
          '-p',
          tip,
          '-m',
          `chore(teambrain): session ${sid}`,
        ],
        repoRoot,
      );
      git(
        ['update-ref', `refs/heads/${SESSIONS_BRANCH}`, commit, tip],
        repoRoot,
      );
      if (this.push) {
        if (tryGit(['push', 'origin', SESSIONS_BRANCH], repoRoot) === null) {
          this.logger?.debug(
            'sessions-branch push deferred; record kept local',
            { sid },
          );
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
