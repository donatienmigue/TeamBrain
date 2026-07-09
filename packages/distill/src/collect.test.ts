import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect } from './collect.js';
import type { PullRequestSource, SessionSource } from './index.js';
import { edit, record } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function brainWithWatermark(watermark: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-collect-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, 'brain.yaml'),
    watermark === null
      ? 'version: 1\n'
      : `version: 1\nstate:\n  distill:\n    watermark: ${watermark}\n`,
    'utf8',
  );
  return dir;
}

describe('collect (M6.1)', () => {
  it('reads new records since the watermark and merged PRs', async () => {
    const brainDir = await brainWithWatermark('wm-1');
    let askedWatermark: string | null = 'unset';
    const sessions: SessionSource = {
      head: () => 'tip-sha',
      readNewRecords: (since) => {
        askedWatermark = since;
        return [record('s1', [edit('s1', 'src/a.ts')], ['c1'])];
      },
    };
    const prs: PullRequestSource = {
      readMergedPRs: () => [
        { number: 5, title: 'PR', files: ['src/a.ts'], commits: ['c1'] },
      ],
      readTeamBrainPRBodies: () => [],
    };

    const result = collect({ repoRoot: '/repo', brainDir, sessions, prs });
    expect(askedWatermark).toBe('wm-1');
    expect(result.fromWatermark).toBe('wm-1');
    expect(result.nextWatermark).toBe('tip-sha');
    expect(result.records.map((r) => r.sid)).toEqual(['s1']);
    expect(result.prs[0]?.number).toBe(5);
  });

  it('passes a null watermark on the first run', async () => {
    const brainDir = await brainWithWatermark(null);
    let askedWatermark: string | null = 'unset';
    const sessions: SessionSource = {
      head: () => null,
      readNewRecords: (since) => {
        askedWatermark = since;
        return [];
      },
    };
    const result = collect({
      repoRoot: '/repo',
      brainDir,
      sessions,
      prs: { readMergedPRs: () => [], readTeamBrainPRBodies: () => [] },
    });
    expect(askedWatermark).toBeNull();
    expect(result.fromWatermark).toBeNull();
    expect(result.nextWatermark).toBeNull();
  });
});
