import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, parseBrainConfig } from '@teambrain/core';
import { pingDaemon } from './hook-client.js';
import { daemonSocketPath } from './paths.js';

// Daemon auto-start on demand (Tech Brief: Daemon Auto-Start). Called from
// the SessionStart context request and `tb mcp` boot — never from the
// sendHookEvent hot path (<20ms budget) and never from plain pingDaemon
// (`tb doctor` must report the truth). Everything degrades: on any failure
// the caller behaves exactly as if the daemon were down today.

/** Overall budget for probe → lock → spawn → daemon answering. */
export const AUTOSTART_DEADLINE_MS = 1500;
/** Per-probe budget; the warm path costs at most one of these. */
export const AUTOSTART_PROBE_TIMEOUT_MS = 150;
/** A lock older than this whose owner is gone is stale and may be broken. */
export const AUTOSTART_LOCK_TTL_MS = 30_000;
/**
 * Circuit breaker: after this many consecutive failed start attempts,
 * autostart stops respawning (a daemon that crashes on boot would otherwise
 * be relaunched by every hook event, forever)…
 */
export const AUTOSTART_MAX_FAILURES = 3;
/** …until this cooldown elapses, when exactly one fresh attempt is allowed. */
export const AUTOSTART_RETRY_COOLDOWN_MS = 10 * 60_000;

const FAILURES_FILE = 'autostart-failures.json';

interface FailureRecord {
  failures: number;
  /** Epoch ms of the last failed attempt. */
  lastFailureAt: number;
}

/** Reads the failure record; anything unreadable/malformed counts as clean. */
function readFailures(runtimeDir: string): FailureRecord {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(runtimeDir, FAILURES_FILE), 'utf8'),
    );
    const record = parsed as { failures?: unknown; lastFailureAt?: unknown };
    if (
      typeof record.failures === 'number' &&
      Number.isFinite(record.failures) &&
      typeof record.lastFailureAt === 'number' &&
      Number.isFinite(record.lastFailureAt)
    ) {
      return {
        failures: record.failures,
        lastFailureAt: record.lastFailureAt,
      };
    }
  } catch {
    /* absent or corrupt → clean slate; the breaker only ever fails open */
  }
  return { failures: 0, lastFailureAt: 0 };
}

function recordFailure(runtimeDir: string, previous: FailureRecord): void {
  try {
    const record: FailureRecord = {
      failures: previous.failures + 1,
      lastFailureAt: Date.now(),
    };
    writeFileSync(
      join(runtimeDir, FAILURES_FILE),
      `${JSON.stringify(record)}\n`,
      'utf8',
    );
  } catch {
    /* a failure we cannot record simply doesn't advance the breaker */
  }
}

function clearFailures(runtimeDir: string): void {
  try {
    unlinkSync(join(runtimeDir, FAILURES_FILE));
  } catch {
    /* already gone */
  }
}

export interface EnsureDaemonOptions {
  runtimeDir: string;
  deadlineMs?: number;
  /**
   * Config kill-switch (brain.yaml `daemon.autostart`). When omitted, the
   * cwd's .teambrain/brain.yaml is consulted; absent config → enabled.
   * TEAMBRAIN_NO_AUTOSTART / CI in the environment override all of these.
   */
  enabled?: boolean;
  /** Injected for tests: how to spawn. Defaults to the real spawner. */
  spawnDaemon?: () => void;
  /** Injected for tests. Defaults to pingDaemon from hook-client. */
  probe?: (runtimeDir: string, timeoutMs: number) => Promise<unknown | null>;
  /**
   * Sink for the one-line cold-start disclosure. Defaults to stderr — never
   * stdout, which is the hook's protocol channel (hookSpecificOutput JSON).
   */
  disclose?: (line: string) => void;
}

function envDisablesAutostart(): boolean {
  const flag = process.env['TEAMBRAIN_NO_AUTOSTART'];
  const ci = process.env['CI'];
  return (
    (flag !== undefined && flag.length > 0) ||
    (ci !== undefined && ci.length > 0)
  );
}

/** brain.yaml `daemon.autostart` from the cwd's brain, best-effort. */
function configEnablesAutostart(): boolean {
  try {
    const configPath = join(process.cwd(), '.teambrain', 'brain.yaml');
    if (!existsSync(configPath)) return true;
    const config = parseBrainConfig(readFileSync(configPath, 'utf8'));
    return config.daemon.autostart;
  } catch {
    return true; // malformed config never blocks the session (principle 2)
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The `tb` CLI entry, resolved relative to this package: in both the
 * monorepo (packages/mcp → packages/cli) and an npm install
 * (@teambrain/mcp → @teambrain/cli) the cli package is a `../../cli`
 * sibling. Null when it isn't there (global installs land on the PATH
 * fallback instead).
 */
function resolveCliEntry(): string | null {
  try {
    const entry = fileURLToPath(
      new URL('../../cli/dist/tb.js', import.meta.url),
    );
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function defaultSpawnDaemon(): { pid: number | undefined } {
  // Tests must never spawn a real daemon (CLAUDE.md testing rules). Suites
  // exercising auto-start inject spawnDaemon; only the real spawner refuses.
  if (process.env['VITEST'] !== undefined) {
    throw new Error('refusing to spawn a real daemon under a test runner');
  }
  const cliEntry = resolveCliEntry();
  // windowsHide: a detached child on Windows otherwise gets its OWN visible
  // console window — and closing that window kills the daemon, so the next
  // hook autostarts it and the window reappears forever.
  const child =
    cliEntry !== null
      ? spawn(process.execPath, [cliEntry, 'serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      : spawn('tb', ['serve'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          // `tb` is tb.cmd on Windows; a shell is required to launch it.
          shell: platform() === 'win32',
        });
  child.unref();
  return { pid: child.pid };
}

interface LockState {
  acquired: boolean;
  /** Owner pid when someone else holds a live lock. */
  ownerAlive: boolean;
}

/** One 'wx' attempt; EEXIST is classified live/stale (stale → broken once). */
function acquireLock(lockPath: string): LockState {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return { acquired: true, ownerAlive: false };
    } catch {
      let stale = true;
      try {
        const ownerPid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
        const ageMs = Date.now() - statSync(lockPath).mtimeMs;
        stale =
          Number.isNaN(ownerPid) ||
          !pidIsAlive(ownerPid) ||
          ageMs > AUTOSTART_LOCK_TTL_MS;
      } catch {
        // Lock vanished between open and read — retry the acquire.
      }
      if (!stale) return { acquired: false, ownerAlive: true };
      try {
        unlinkSync(lockPath);
      } catch {
        /* someone else broke it first */
      }
    }
  }
  return { acquired: false, ownerAlive: false };
}

/**
 * Ensures a daemon is listening for `runtimeDir`: probes, and — unless
 * autostart is disabled — spawns `tb serve` detached behind an exclusive
 * lock so concurrent sessions start exactly one daemon. Returns true if a
 * daemon is (now) alive. NEVER throws; every failure returns false and the
 * caller degrades exactly as today.
 */
export async function ensureDaemon(
  opts: EnsureDaemonOptions,
): Promise<boolean> {
  const log = createLogger().child({ component: 'autostart' });
  try {
    const probe =
      opts.probe ??
      ((dir: string, timeoutMs: number): Promise<unknown | null> =>
        pingDaemon(dir, timeoutMs));
    const disabled =
      envDisablesAutostart() ||
      opts.enabled === false ||
      (opts.enabled === undefined && !configEnablesAutostart());

    if (disabled) {
      return (
        (await probe(opts.runtimeDir, AUTOSTART_PROBE_TIMEOUT_MS)) !== null
      );
    }

    // Warm path: one short probe, no spawn, ~nothing added.
    if ((await probe(opts.runtimeDir, AUTOSTART_PROBE_TIMEOUT_MS)) !== null) {
      return true;
    }

    // Circuit breaker: a daemon that crashes on boot must not be respawned
    // by every hook event forever. After AUTOSTART_MAX_FAILURES consecutive
    // failed starts, suppress spawning until the cooldown elapses; then one
    // fresh attempt is allowed (half-open) and success clears the record.
    const failures = readFailures(opts.runtimeDir);
    if (failures.failures >= AUTOSTART_MAX_FAILURES) {
      const sinceMs = Date.now() - failures.lastFailureAt;
      if (sinceMs < AUTOSTART_RETRY_COOLDOWN_MS) {
        log.debug('autostart suppressed after repeated start failures', {
          failures: failures.failures,
          retryInMs: AUTOSTART_RETRY_COOLDOWN_MS - sinceMs,
        });
        return false;
      }
    }

    const deadlineMs = opts.deadlineMs ?? AUTOSTART_DEADLINE_MS;
    const deadline = Date.now() + deadlineMs;
    const pollUntilDeadline = async (): Promise<boolean> => {
      let backoffMs = 50;
      while (Date.now() < deadline) {
        await sleep(Math.min(backoffMs, Math.max(1, deadline - Date.now())));
        backoffMs = Math.min(backoffMs * 2, 200);
        if (
          (await probe(opts.runtimeDir, AUTOSTART_PROBE_TIMEOUT_MS)) !== null
        ) {
          return true;
        }
      }
      return false;
    };

    mkdirSync(opts.runtimeDir, { recursive: true });
    const lockPath = join(opts.runtimeDir, 'daemon.lock');
    const lock = acquireLock(lockPath);
    if (!lock.acquired) {
      if (lock.ownerAlive) {
        // Another client is starting the daemon — wait, never double-spawn.
        return await pollUntilDeadline();
      }
      log.debug('autostart lock unavailable', { lockPath });
      return false;
    }

    try {
      // A socket file with no listener would EADDRINUSE the new daemon.
      // (Windows named pipes vanish with their process — nothing to clear.)
      if (platform() !== 'win32') {
        const socketPath = daemonSocketPath(opts.runtimeDir);
        if (existsSync(socketPath)) {
          try {
            unlinkSync(socketPath);
          } catch (err) {
            log.debug('stale socket unlink failed', {
              reason: (err as Error).message,
            });
          }
        }
      }

      let spawnedPid: number | undefined;
      let alive = false;
      try {
        if (opts.spawnDaemon !== undefined) {
          opts.spawnDaemon();
        } else {
          spawnedPid = defaultSpawnDaemon().pid;
        }
        alive = await pollUntilDeadline();
      } catch (err) {
        // A throwing spawn is a failed attempt like any other: it advances
        // the breaker below instead of bypassing it via the outer catch.
        log.debug('autostart spawn failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      if (alive) {
        clearFailures(opts.runtimeDir);
        // Trust surface: a process the user didn't start is disclosed, once,
        // on stderr only (stdout belongs to the hook protocol).
        const pong = await probe(opts.runtimeDir, AUTOSTART_PROBE_TIMEOUT_MS);
        const pid =
          pong !== null &&
          typeof pong === 'object' &&
          typeof (pong as { pid?: unknown }).pid === 'number'
            ? (pong as { pid: number }).pid
            : spawnedPid;
        const write =
          opts.disclose ??
          ((line: string): void => {
            process.stderr.write(line);
          });
        write(
          `TeamBrain: started local daemon (pid ${pid ?? 'unknown'}). Stop with 'tb serve --stop'.\n`,
        );
      } else {
        recordFailure(opts.runtimeDir, failures);
        if (failures.failures + 1 >= AUTOSTART_MAX_FAILURES) {
          // Trust surface: tell the user we are giving up, once per trip.
          const write =
            opts.disclose ??
            ((line: string): void => {
              process.stderr.write(line);
            });
          write(
            `TeamBrain: daemon failed to start ${failures.failures + 1} ` +
              `times; autostart paused for ${Math.round(
                AUTOSTART_RETRY_COOLDOWN_MS / 60_000,
              )} min. Run 'tb serve' in a terminal to see why.\n`,
          );
        }
        log.debug('autostart: daemon did not answer before deadline', {
          deadlineMs,
          consecutiveFailures: failures.failures + 1,
        });
      }
      return alive;
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  } catch (err) {
    log.debug('autostart failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
