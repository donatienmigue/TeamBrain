import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDoctorCommand } from './doctor-command.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function emptyRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-doctor-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb doctor (M4.3)', () => {
  it('reports the daemon unreachable and exits 2 when nothing is running', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const result = await runDoctorCommand({ runtimeDir });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('socket reachable: FAIL');
    expect(result.output).toContain('tb serve');
  });

  it('emits machine-readable JSON with --json', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const result = await runDoctorCommand({ runtimeDir, json: true });
    const report = JSON.parse(result.output);
    expect(report.ok).toBe(false);
    expect(report.daemon.reachable).toBe(false);
    expect(typeof report.index.dbPath).toBe('string');
  });
});
