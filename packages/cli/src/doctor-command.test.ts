import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { heartbeatPath } from '@teambrain/mcp';
import { doctorReportSchema, runDoctorCommand } from './doctor-command.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function emptyRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-doctor-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb doctor (M7.2)', () => {
  it('reports the daemon unreachable and exits 2 when nothing is running', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const result = await runDoctorCommand({ runtimeDir });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('socket reachable: FAIL');
    expect(result.output).toContain('tb serve');
  });

  it('emits JSON that validates against the report schema (Accept)', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const result = await runDoctorCommand({ runtimeDir, json: true });
    const parsed = doctorReportSchema.safeParse(JSON.parse(result.output));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.daemon.reachable).toBe(false);
      expect(parsed.data.retrieval.samples).toBe(0);
      expect(parsed.data.hooks).toEqual([]);
    }
  });

  it('surfaces the §6 observability fields from a heartbeat', async () => {
    const runtimeDir = await emptyRuntimeDir();
    await writeFile(
      heartbeatPath(runtimeDir),
      JSON.stringify({
        pid: 999999, // almost certainly not alive
        startedAt: '2026-07-06T09:00:00.000Z',
        lastBeat: '2026-07-06T09:10:00.000Z',
        docCount: 42,
        lexicalOnly: false,
        brainChecksum: 'abc123',
        brainDir: '/tmp/nope/.teambrain',
        lastReindexAt: '2026-07-06T09:05:00.000Z',
        hooks: {
          'claude-code': { lastEventAt: '2026-07-06T09:09:00.000Z', count: 7 },
        },
        retrieval: { p95Ms: 12.5, samples: 30 },
      }),
      'utf8',
    );

    const result = await runDoctorCommand({
      runtimeDir,
      json: true,
      now: () => new Date('2026-07-06T09:10:30.000Z'),
    });
    const report = doctorReportSchema.parse(JSON.parse(result.output));

    expect(report.index.docCount).toBe(42);
    expect(report.index.brainChecksum).toBe('abc123');
    expect(report.index.lastReindexAt).toBe('2026-07-06T09:05:00.000Z');
    expect(report.retrieval).toEqual({ p95Ms: 12.5, samples: 30 });
    expect(report.hooks).toEqual([
      {
        tool: 'claude-code',
        lastEventAt: '2026-07-06T09:09:00.000Z',
        count: 7,
      },
    ]);
    // uptime = generatedAt − startedAt = 630s.
    expect(report.daemon.uptimeSeconds).toBe(630);
    // No git upstream for the fake brain dir → branch-synced check is inert.
    expect(report.sync.behind).toBeNull();
  });

  it('ignores a corrupt heartbeat and still produces a valid report', async () => {
    const runtimeDir = await emptyRuntimeDir();
    await writeFile(heartbeatPath(runtimeDir), 'not json{', 'utf8');
    const result = await runDoctorCommand({ runtimeDir, json: true });
    expect(
      doctorReportSchema.safeParse(JSON.parse(result.output)).success,
    ).toBe(true);
  });
});

describe('tb doctor governance metric (D3.1)', () => {
  it('includes injected governance in JSON and human output, schema-valid', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const governance = { mergedProposalPRs: 4, medianHoursToMerge: 18.5 };
    const json = await runDoctorCommand({ runtimeDir, json: true, governance });
    const report = doctorReportSchema.parse(JSON.parse(json.output));
    expect(report.governance).toEqual(governance);

    const human = await runDoctorCommand({ runtimeDir, governance });
    expect(human.output).toContain('proposal merges:  4 PR(s), median 18.5h');
  });

  it('negative: omits governance entirely when not supplied', async () => {
    const runtimeDir = await emptyRuntimeDir();
    const result = await runDoctorCommand({ runtimeDir, json: true });
    expect(JSON.parse(result.output)).not.toHaveProperty('governance');
  });
});
