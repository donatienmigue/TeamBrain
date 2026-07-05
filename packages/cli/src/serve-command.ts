import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  EnvironmentError,
  createLogger,
  exitCodeForError,
} from '@teambrain/core';
import {
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
  const daemon = await startDaemon({
    runtimeDir: resolveRuntimeDir(),
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
