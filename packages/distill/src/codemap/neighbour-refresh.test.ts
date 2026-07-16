import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '@teambrain/core';
import { fakeProvider } from '../fake-provider.js';
import { readCodemapEntries, updateCodemap } from './generate.js';

// R16.1 T6: summaries reference cross-module dependencies, so deleting or
// renaming a file leaves its neighbours' summaries wrong — while their own
// hashes are unchanged. Entries mentioning a dead path are force-refreshed,
// with a bounded fan-out per run.

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0)
    rmSync(cleanups.pop() as string, { recursive: true, force: true });
});

function scratchRepo(): { repoRoot: string; brainDir: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'tb-neighbour-'));
  cleanups.push(repoRoot);
  const brainDir = join(repoRoot, '.teambrain');
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  mkdirSync(brainDir, { recursive: true });
  return { repoRoot, brainDir };
}

const NOW = { now: () => new Date('2026-07-15T12:00:00Z') };

/** First-run provider: a.ts's summary references src/b.ts. */
function referencingProvider(): ReturnType<typeof fakeProvider> {
  return fakeProvider(({ prompt }) => {
    const path = /^File: (.*)$/m.exec(prompt)?.[1] ?? 'unknown';
    return {
      summary:
        path === 'src/a.ts'
          ? 'Delegates retries to src/b.ts and re-exports its config.'
          : `Summary of ${path}.`,
    };
  });
}

/** Later-run provider: plain summaries, records which files it saw. */
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

describe('neighbour refresh on removed paths (R16.1 T6)', () => {
  it('deleting b.ts re-summarizes a.ts, whose summary referenced it', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repoRoot, 'src', 'b.ts'), 'export const b = 2;\n');
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: referencingProvider(),
      ...NOW,
    });
    const before = readCodemapEntries(brainDir).find(
      (e) => e.path === 'src/a.ts',
    );
    expect(before?.body).toContain('src/b.ts');

    rmSync(join(repoRoot, 'src', 'b.ts'));
    const { provider, calls } = countingProvider();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      ...NOW,
    });

    expect(result.removed).toEqual(['src/b.ts']);
    // a.ts was re-summarized this run despite an unchanged hash…
    expect(result.refreshed).toEqual(['src/a.ts']);
    expect(calls).toEqual(['src/a.ts']);
    // …and its new summary no longer references the dead path.
    const after = readCodemapEntries(brainDir).find(
      (e) => e.path === 'src/a.ts',
    );
    expect(after?.body).toBe('Summary of src/a.ts.');
    expect(after?.body).not.toContain('src/b.ts');
  });

  it('negative: entries that never mentioned the dead path are not re-summarized', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repoRoot, 'src', 'b.ts'), 'export const b = 2;\n');
    writeFileSync(join(repoRoot, 'src', 'c.ts'), 'export const c = 3;\n');
    await updateCodemap({
      repoRoot,
      brainDir,
      provider: referencingProvider(),
      ...NOW,
    });

    rmSync(join(repoRoot, 'src', 'b.ts'));
    const { provider, calls } = countingProvider();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      ...NOW,
    });
    // c.ts's summary ("Summary of src/c.ts.") mentions nothing dead: untouched.
    expect(result.refreshed).toEqual(['src/a.ts']);
    expect(calls).toEqual(['src/a.ts']);
    expect(result.unchanged).toBe(2);
  });

  it('fan-out is capped and the cap is logged, never silent', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'hub.ts'), 'export const h = 1;\n');
    for (let i = 0; i < 4; i += 1) {
      writeFileSync(
        join(repoRoot, 'src', `dep${i}.ts`),
        `export const d = ${i};\n`,
      );
    }
    // Every dep's summary references the hub.
    const seeding = fakeProvider(({ prompt }) => {
      const path = /^File: (.*)$/m.exec(prompt)?.[1] ?? 'unknown';
      return {
        summary: path.startsWith('src/dep')
          ? `Imports src/hub.ts. Summary of ${path}.`
          : `Summary of ${path}.`,
      };
    });
    await updateCodemap({ repoRoot, brainDir, provider: seeding, ...NOW });

    rmSync(join(repoRoot, 'src', 'hub.ts'));
    const logs: Array<[string, unknown]> = [];
    const logger = {
      debug: (message: string, fields?: Record<string, unknown>): void => {
        logs.push([message, fields]);
      },
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    const { provider, calls } = countingProvider();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      logger,
      maxNeighbourRefresh: 2,
      ...NOW,
    });

    expect(result.refreshed).toHaveLength(2);
    expect(calls).toHaveLength(2);
    const capLog = logs.find(([message]) =>
      message.includes('neighbour refresh capped'),
    );
    expect(capLog).toBeDefined();
    expect(capLog?.[1]).toMatchObject({ eligible: 4, limit: 2 });
  });
});
