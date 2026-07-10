import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeProvider } from '../fake-provider.js';
import {
  readCodemapEntries,
  readCodemapManifest,
  updateCodemap,
} from './generate.js';

// D6 acceptance seeds: incremental hash-manifest behavior. The negative
// tests are the point — unchanged files must NOT hit the provider, and
// deleted files must NOT keep serving.

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0)
    rmSync(cleanups.pop()!, {
      recursive: true,
      force: true,
    });
});

function scratchRepo(): { repoRoot: string; brainDir: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'tb-codemap-'));
  cleanups.push(repoRoot);
  const brainDir = join(repoRoot, '.teambrain');
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repoRoot, 'src', 'b.ts'), 'export const b = 2;\n');
  writeFileSync(join(repoRoot, 'README.md'), '# not a source file\n');
  return { repoRoot, brainDir };
}

function countingProvider(): {
  provider: ReturnType<typeof fakeProvider>;
  calls: string[];
} {
  const calls: string[] = [];
  const provider = fakeProvider(({ prompt }) => {
    const path = /^File: (.*)$/m.exec(prompt)?.[1] ?? 'unknown';
    calls.push(path);
    return { summary: `Summary of ${path}.` };
  });
  return { provider, calls };
}

const NOW = { now: () => new Date('2026-07-10T12:00:00Z') };

describe('updateCodemap (D6/R16 incremental pipeline)', () => {
  it('initial run summarizes every source file and writes entries + manifest', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    const { provider, calls } = countingProvider();

    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      ...NOW,
    });

    expect(result.summarized.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.total).toBe(2); // README.md filtered out
    expect(calls.sort()).toEqual(['src/a.ts', 'src/b.ts']);

    const entries = readCodemapEntries(brainDir);
    expect(entries.map((e) => e.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(entries[0]?.body).toBe('Summary of src/a.ts.');
    expect(Object.keys(readCodemapManifest(brainDir).files)).toHaveLength(2);
  });

  it('negative: an unchanged repo never calls the provider again', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    const first = countingProvider();
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: first.provider,
      ...NOW,
    });

    const second = countingProvider();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: second.provider,
      ...NOW,
    });
    expect(second.calls).toEqual([]);
    expect(result.summarized).toEqual([]);
    expect(result.unchanged).toBe(2);
  });

  it('re-summarizes exactly the changed file', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: countingProvider().provider,
      ...NOW,
    });

    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 42;\n');
    const { provider, calls } = countingProvider();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      ...NOW,
    });

    expect(calls).toEqual(['src/a.ts']);
    expect(result.summarized).toEqual(['src/a.ts']);
    expect(result.unchanged).toBe(1);
  });

  it('negative: a deleted file loses its entry within one update cycle', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: countingProvider().provider,
      ...NOW,
    });
    expect(
      existsSync(join(brainDir, 'codemap', 'files', 'src', 'b.ts.md')),
    ).toBe(true);

    rmSync(join(repoRoot, 'src', 'b.ts'));
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: countingProvider().provider,
      ...NOW,
    });

    expect(result.removed).toEqual(['src/b.ts']);
    expect(
      existsSync(join(brainDir, 'codemap', 'files', 'src', 'b.ts.md')),
    ).toBe(false);
    expect(readCodemapEntries(brainDir).map((e) => e.path)).toEqual([
      'src/a.ts',
    ]);
    expect(readCodemapManifest(brainDir).files['src/b.ts']).toBeUndefined();
  });

  it('a failed summary keeps the old entry serving and retries next run', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: countingProvider().provider,
      ...NOW,
    });

    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 3;\n');
    const failing = fakeProvider(() => {
      throw new Error('model unavailable');
    });
    const failedRun = await updateCodemap({
      repoRoot,
      brainDir,
      provider: failing,
      ...NOW,
    });
    expect(failedRun.summarized).toEqual([]);
    // Old summary still serves (stale beats absent within a cycle).
    expect(readCodemapEntries(brainDir).map((e) => e.path)).toContain(
      'src/a.ts',
    );

    // Next healthy run retries the file.
    const { provider, calls } = countingProvider();
    await updateCodemap({ repoRoot, brainDir, provider, ...NOW });
    expect(calls).toEqual(['src/a.ts']);
  });
});
