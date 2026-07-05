import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// Machine-local runtime layout (C7): ~/.teambrain/{spool, index.db, logs}
// plus the daemon's socket, pidfile, and heartbeat. Everything here is
// derivable from a single runtime dir so tests can point at a TMPDIR fake
// (CLAUDE.md forbids touching the real home in tests).

/**
 * The runtime dir, honoring `TEAMBRAIN_HOME` (used by tests and to run a
 * daemon against an isolated home) before falling back to ~/.teambrain (C7).
 */
export function resolveRuntimeDir(): string {
  const override = process.env['TEAMBRAIN_HOME'];
  return override !== undefined && override.length > 0
    ? override
    : join(homedir(), '.teambrain');
}

export function pidFilePath(runtimeDir: string): string {
  return join(runtimeDir, 'daemon.pid');
}

export function heartbeatPath(runtimeDir: string): string {
  return join(runtimeDir, 'daemon.json');
}

export function indexDbPath(runtimeDir: string): string {
  return join(runtimeDir, 'index.db');
}

export function candidateSpoolDir(runtimeDir: string): string {
  return join(runtimeDir, 'spool', 'candidates');
}

export function feedbackSpoolPath(runtimeDir: string): string {
  return join(runtimeDir, 'spool', 'feedback.jsonl');
}

/**
 * The daemon's local listening address. POSIX gets the C7 unix socket path;
 * Windows has no unix sockets in the C7 sense, so we use a named pipe whose
 * name is keyed to the runtime dir (pipes share one global namespace — the
 * hash keeps two homes on one machine from colliding).
 */
export function daemonSocketPath(runtimeDir: string): string {
  if (platform() === 'win32') {
    const tag = createHash('sha256').update(runtimeDir).digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\teambrain-${tag}`;
  }
  return join(runtimeDir, 'daemon.sock');
}
