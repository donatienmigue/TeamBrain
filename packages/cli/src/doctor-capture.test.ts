import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { heartbeatPath } from '@teambrain/mcp';
import { ADAPTERS } from '@teambrain/hooks';
import { doctorReportSchema, runDoctorCommand } from './doctor-command.js';

// A0.5 doctor honesty: the capture level doctor reports for each tool is the
// adapter's own describeDegradation() — never a hand-written string that can
// drift from the declared capabilities.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function runtimeDirWithHooks(tools: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-doctor-capture-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const hooks: Record<string, { lastEventAt: string; count: number }> = {};
  for (const tool of tools) {
    hooks[tool] = { lastEventAt: '2026-07-14T09:00:00.000Z', count: 3 };
  }
  await writeFile(heartbeatPath(dir), JSON.stringify({ hooks }), 'utf8');
  return dir;
}

describe('tb doctor capture honesty (A0.5 / D6)', () => {
  it('reports exactly the adapter-declared capture level for every tool', async () => {
    const tools = Object.keys(ADAPTERS);
    const runtimeDir = await runtimeDirWithHooks(tools);
    const result = await runDoctorCommand({ runtimeDir, json: true });
    const report = doctorReportSchema.parse(JSON.parse(result.output));

    for (const tool of tools) {
      const entry = report.hooks.find((h) => h.tool === tool);
      expect(entry?.captureLevel).toBe(ADAPTERS[tool]?.describeDegradation());
    }
  });

  it('leaves capture level unset for tools without a registered adapter', async () => {
    const runtimeDir = await runtimeDirWithHooks(['mystery-agent']);
    const result = await runDoctorCommand({ runtimeDir, json: true });
    const report = doctorReportSchema.parse(JSON.parse(result.output));
    const entry = report.hooks.find((h) => h.tool === 'mystery-agent');
    expect(entry).toBeDefined();
    expect(entry?.captureLevel).toBeUndefined();
  });

  it('human output surfaces the degradation line per tool', async () => {
    const runtimeDir = await runtimeDirWithHooks(['cursor']);
    const result = await runDoctorCommand({ runtimeDir });
    expect(result.output).toContain(
      '(Cursor lacks native hooks; edit/command telemetry unavailable)',
    );
  });
});
