import { existsSync, readFileSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';
import {
  EnvironmentError,
  createLogger,
  exitCodeForError,
} from '@teambrain/core';
import {
  daemonSocketPath,
  ensureUserScopeDir,
  heartbeatPath,
  pidFilePath,
  resolveRuntimeDir,
  startDaemon,
  type DaemonHandle,
} from '@teambrain/mcp';
import type { ErrorExitCode } from '@teambrain/core';

// `tb serve` (M4.1 entry): resolve the repo's brain, start the daemon, and
// stay alive until a termination signal. The daemon holds the process open
// via its socket server; this command just wires signals to a clean close.

export interface ServeOptions {
  /** Injected for tests so they can stop the daemon without a real signal. */
  onReady?: (daemon: DaemonHandle) => void;
  /** Resolves the promise (test hook); production waits on SIGINT/SIGTERM. */
  signal?: AbortSignal;
}

export interface ServeStopOptions {
  /** Injected for tests; defaults to the real ~/.teambrain. */
  runtimeDir?: string;
  /** How long to wait for the daemon to exit after SIGTERM. */
  waitMs?: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes pidfile, heartbeat, autostart lock, and (POSIX) socket file. */
function removeDaemonFiles(runtimeDir: string): void {
  const files = [
    pidFilePath(runtimeDir),
    heartbeatPath(runtimeDir),
    join(runtimeDir, 'daemon.lock'),
    ...(platform() === 'win32' ? [] : [daemonSocketPath(runtimeDir)]),
  ];
  for (const file of files) {
    try {
      rmSync(file);
    } catch {
      /* already gone */
    }
  }
}

/**
 * `tb serve --stop` — the counterpart to daemon auto-start ("nothing running
 * you didn't ask for" needs a one-command off switch). Terminates the daemon
 * from its pidfile and removes pidfile + heartbeat + socket + autostart lock.
 * Idempotent: already-stopped exits 0.
 */
export async function runServeStopCommand(
  options: ServeStopOptions = {},
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  const pidPath = pidFilePath(runtimeDir);

  let pid: number | null = null;
  if (existsSync(pidPath)) {
    const parsed = Number.parseInt(readFileSync(pidPath, 'utf8'), 10);
    pid = Number.isNaN(parsed) ? null : parsed;
  }

  if (pid === null || !pidAlive(pid)) {
    removeDaemonFiles(runtimeDir);
    return { exitCode: 0, output: 'TeamBrain daemon already stopped.\n' };
  }

  try {
    process.kill(pid);
  } catch (err) {
    return {
      exitCode: exitCodeForError(
        new EnvironmentError(
          `could not stop daemon pid ${pid}: ${(err as Error).message}`,
        ),
      ),
      output: `tb serve --stop: could not stop daemon pid ${pid}\n`,
    };
  }

  const deadline = Date.now() + (options.waitMs ?? 3000);
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (pidAlive(pid)) {
    return {
      exitCode: exitCodeForError(
        new EnvironmentError(`daemon pid ${pid} did not exit`),
      ),
      output: `tb serve --stop: daemon pid ${pid} did not exit — stop it manually\n`,
    };
  }

  removeDaemonFiles(runtimeDir);
  return {
    exitCode: 0,
    output: `TeamBrain daemon stopped (pid ${pid}).\n`,
  };
}

export async function runServeCommand(
  repoDir: string,
  options: ServeOptions = {},
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  const root = resolve(repoDir);
  const brainDir = join(root, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: exitCodeForError(
        new EnvironmentError(
          `no brain at ${brainDir} — run \`tb init\` and merge its PR first`,
        ),
      ),
      output: `tb serve: no brain at ${brainDir} — run \`tb init\` first\n`,
    };
  }

  const logger = createLogger().child({ component: 'serve' });
  const runtimeDir = resolveRuntimeDir();
  // Materialize the C7 layout's user/ store here in the CLI layer — the
  // daemon's sync code must never know this path exists (F4 separation).
  ensureUserScopeDir(runtimeDir);
  const daemon = await startDaemon({
    runtimeDir,
    brainDir,
    logger,
  });
  process.stdout.write(
    `TeamBrain daemon started (pid ${daemon.pid}).\n` +
      `  brain:  ${brainDir}\n` +
      `  socket: ${daemon.socketPath}\n` +
      'Watching for changes. Press Ctrl+C to stop.\n',
  );

  await new Promise<void>((resolvePromise) => {
    const shutdown = (): void => {
      void daemon.close().then(() => resolvePromise());
    };
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', shutdown, { once: true });
    }
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    options.onReady?.(daemon);
  });

  return { exitCode: 0, output: 'TeamBrain daemon stopped.\n' };
}
