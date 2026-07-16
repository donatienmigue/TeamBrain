import { execFile, type ChildProcess } from 'node:child_process';
import type { Logger } from '@teambrain/core';

// R16.1 (P1): the daemon's session-scoping signal for the codemap slice.
// Two sources, both metadata-only: repo paths from captured tool_use events
// (C2 already carries `path`), and the current branch's diff vs the default
// branch. Everything here is best-effort — a repo without git, no remote, or
// an unreadable HEAD degrades to "no signal" (principle 2), logged at debug.

/** Most-recently-touched paths kept; older ones age out first. */
const MAX_TRACKED_PATHS = 50;

const GIT_TIMEOUT_MS = 10_000;

/**
 * Normalizes a tool_use path to a repo-relative posix path, or null when it
 * cannot belong to the repo (absolute path outside the repo root).
 */
export function toRepoRelative(path: string, repoRoot: string): string | null {
  const normalized = path.replaceAll('\\', '/');
  const root = repoRoot.replaceAll('\\', '/').replace(/\/+$/, '');
  if (normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  // Absolute (posix or drive-lettered) but not under the repo root.
  if (/^([a-zA-Z]:)?\//.test(normalized)) return null;
  return normalized;
}

/**
 * Tracks the session-relevant repo paths the daemon knows about: recently
 * touched files (bounded, newest kept) plus the branch diff vs the default
 * branch (refreshed on the git-fetch cadence).
 */
export class SessionPathTracker {
  private readonly recent: string[] = [];
  private diffPaths: string[] = [];
  private readonly pending = new Set<ChildProcess>();
  private closed = false;

  constructor(
    private readonly repoRoot: string,
    private readonly logger?: Logger,
    private readonly cap: number = MAX_TRACKED_PATHS,
  ) {}

  /** Records a tool_use path (absolute or repo-relative). */
  record(path: string): void {
    const relative = toRepoRelative(path, this.repoRoot);
    if (relative === null) return;
    const at = this.recent.indexOf(relative);
    if (at !== -1) this.recent.splice(at, 1);
    this.recent.push(relative);
    if (this.recent.length > this.cap) this.recent.shift();
  }

  /** The current scoping signal: recent paths ∪ branch-diff paths. */
  paths(): string[] {
    return [...new Set([...this.recent, ...this.diffPaths])];
  }

  /**
   * Refreshes the branch-diff arm asynchronously. Tries the remote default
   * branch first, then main/master. `onDone` fires once the refresh settles
   * (tests); failures leave the previous diff in place.
   */
  refreshBranchDiff(onDone?: () => void): void {
    if (this.closed) {
      onDone?.();
      return;
    }
    const git = (args: string[], cb: (out: string | null) => void): void => {
      // Once closed, never spawn again — a killed child's error callback
      // would otherwise launch the next fallback base after shutdown.
      if (this.closed) {
        cb(null);
        return;
      }
      const child = execFile(
        'git',
        ['-C', this.repoRoot, ...args],
        // windowsHide: the daemon has no console; without it every git
        // child flashes a console window on Windows.
        { timeout: GIT_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          this.pending.delete(child);
          if (err) {
            this.logger?.debug('session-path git query skipped', {
              args: args.join(' '),
              reason: err.message,
            });
            cb(null);
            return;
          }
          cb(this.closed ? null : stdout);
        },
      );
      this.pending.add(child);
    };
    git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], (head) => {
      const bases =
        head === null ? ['main', 'master'] : [head.trim(), 'main', 'master'];
      const tryBase = (i: number): void => {
        if (i >= bases.length) {
          onDone?.();
          return;
        }
        git(['diff', '--name-only', bases[i] as string], (out) => {
          if (out === null) {
            tryBase(i + 1);
            return;
          }
          this.diffPaths = out
            .split('\n')
            .map((line) => line.trim().replaceAll('\\', '/'))
            .filter((line) => line !== '');
          onDone?.();
        });
      };
      tryBase(0);
    });
  }

  /**
   * Stops the tracker: no further refreshes, and any in-flight git process
   * is killed and awaited so no file handle outlives the daemon (Windows
   * temp-dir cleanup in tests would otherwise hit EBUSY).
   */
  async close(): Promise<void> {
    this.closed = true;
    const exits = [...this.pending].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
          child.kill();
        }),
    );
    // Bounded wait: a wedged git must not block daemon shutdown.
    await Promise.race([
      Promise.all(exits),
      new Promise((resolve) => setTimeout(resolve, 1000).unref()),
    ]);
  }
}
