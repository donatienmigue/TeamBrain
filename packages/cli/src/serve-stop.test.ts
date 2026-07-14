import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pidFilePath } from '@teambrain/mcp';
import { runServeStopCommand } from './serve-command.js';

// `tb serve --stop` (daemon auto-start Task 4b): idempotent off switch. No
// real daemons here — a plain sleeper subprocess stands in for one.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-stop-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb serve --stop', () => {
  it('exits 0 when nothing is running (idempotent), twice in a row', async () => {
    const runtimeDir = await tempRuntimeDir();
    const first = await runServeStopCommand({ runtimeDir });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('already stopped');
    const second = await runServeStopCommand({ runtimeDir });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already stopped');
  });

  it('cleans up a stale pidfile (dead pid) and leftover lock', async () => {
    const runtimeDir = await tempRuntimeDir();
    await writeFile(pidFilePath(runtimeDir), '999999999\n', 'utf8');
    await writeFile(join(runtimeDir, 'daemon.lock'), '999999999\n', 'utf8');
    const result = await runServeStopCommand({ runtimeDir });
    expect(result.exitCode).toBe(0);
    expect(existsSync(pidFilePath(runtimeDir))).toBe(false);
    expect(existsSync(join(runtimeDir, 'daemon.lock'))).toBe(false);
  });

  it('terminates the process named in the pidfile and removes it', async () => {
    const runtimeDir = await tempRuntimeDir();
    // A sleeper subprocess stands in for the daemon (never a real one).
    const sleeper = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
      },
    );
    cleanups.push(() => {
      try {
        sleeper.kill();
      } catch {
        /* already dead */
      }
    });
    await writeFile(pidFilePath(runtimeDir), `${sleeper.pid}\n`, 'utf8');

    const result = await runServeStopCommand({ runtimeDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`stopped (pid ${sleeper.pid})`);
    expect(existsSync(pidFilePath(runtimeDir))).toBe(false);

    // The pid is actually gone; a second stop is a no-op.
    const second = await runServeStopCommand({ runtimeDir });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already stopped');
  });
});
