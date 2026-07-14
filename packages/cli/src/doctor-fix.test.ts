import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorReportSchema, runDoctorCommand } from './doctor-command.js';

// `tb doctor --fix` (daemon auto-start Task 4c). The autostart function is
// always injected: these tests never spawn a real daemon.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function emptyRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-doctor-fix-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb doctor --fix', () => {
  it('without --fix doctor never invokes auto-start (truthful "down")', async () => {
    const runtimeDir = await emptyRuntimeDir();
    let autostarts = 0;
    const result = await runDoctorCommand({
      runtimeDir,
      autostart: (): Promise<boolean> => {
        autostarts += 1;
        return Promise.resolve(true);
      },
    });
    expect(autostarts).toBe(0);
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('socket reachable: FAIL');
    expect(result.output).not.toContain('autostart fix');
  });

  it('with --fix on a down daemon: attempts auto-start and reports the result', async () => {
    const runtimeDir = await emptyRuntimeDir();
    let autostarts = 0;
    // The injected autostart "succeeds" but starts nothing, so the report
    // still truthfully shows the daemon down — doctor reports, never fakes.
    const result = await runDoctorCommand({
      runtimeDir,
      fix: true,
      json: true,
      autostart: (): Promise<boolean> => {
        autostarts += 1;
        return Promise.resolve(false);
      },
    });
    expect(autostarts).toBe(1);
    const report = doctorReportSchema.parse(JSON.parse(result.output));
    const fix = report.checks.find((check) => check.name === 'autostart-fix');
    expect(fix).toMatchObject({ ok: false });
    expect(report.daemon.reachable).toBe(false);

    const human = await runDoctorCommand({
      runtimeDir,
      fix: true,
      autostart: () => Promise.resolve(false),
    });
    expect(human.output).toContain('autostart fix:    FAIL');
  });
});
