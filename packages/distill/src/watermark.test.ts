import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readDistillWatermark, writeDistillWatermark } from './watermark.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempBrain(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-wm-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'brain.yaml'), yaml, 'utf8');
  return dir;
}

describe('distill watermark', () => {
  it('returns null when there is no state block', async () => {
    const brainDir = await tempBrain(
      'version: 1\ncapture:\n  level: metadata\n',
    );
    expect(readDistillWatermark(brainDir)).toBeNull();
  });

  it('reads a persisted watermark', async () => {
    const brainDir = await tempBrain(
      'version: 1\nstate:\n  distill:\n    watermark: abc123\n',
    );
    expect(readDistillWatermark(brainDir)).toBe('abc123');
  });

  it('round-trips a written watermark while preserving other keys', async () => {
    const brainDir = await tempBrain(
      'version: 1\ncapture:\n  level: metadata\nrequired_tags: []\n',
    );
    writeDistillWatermark(
      brainDir,
      'deadbeef',
      new Date('2026-07-05T00:00:00Z'),
    );

    expect(readDistillWatermark(brainDir)).toBe('deadbeef');
    const config = parse(await readFile(join(brainDir, 'brain.yaml'), 'utf8'));
    expect(config.version).toBe(1);
    expect(config.capture.level).toBe('metadata');
    expect(config.state.distill.updated_at).toBe('2026-07-05T00:00:00.000Z');
  });

  it('advances an existing watermark', async () => {
    const brainDir = await tempBrain(
      'version: 1\nstate:\n  distill:\n    watermark: old\n',
    );
    writeDistillWatermark(brainDir, 'new');
    expect(readDistillWatermark(brainDir)).toBe('new');
  });
});
