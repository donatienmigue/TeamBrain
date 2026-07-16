import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeCodemapEntry } from '@teambrain/core';
import { openIndex, syncIndexWithCodemap } from '@teambrain/index';
import { fakeProvider } from '../fake-provider.js';
import {
  readCodemapEntries,
  readCodemapManifest,
  updateCodemap,
} from './generate.js';

// R16.1 T5: the entry tree is a strict projection of the manifest. Every
// churn scenario from the brief — add, edit, rename (file + directory),
// delete, corrupt manifest, idempotence — asserted against disk, manifest,
// AND retrieval (a real SqliteIndex synced from the swept tree).

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function scratchRepo(): { repoRoot: string; brainDir: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'tb-sweep-'));
  cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  const brainDir = join(repoRoot, '.teambrain');
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  mkdirSync(brainDir, { recursive: true });
  return { repoRoot, brainDir };
}

function provider(): ReturnType<typeof fakeProvider> {
  return fakeProvider(({ prompt }) => {
    const path = /^File: (.*)$/m.exec(prompt)?.[1] ?? 'unknown';
    return { summary: `Summary of ${path}.` };
  });
}

const NOW = { now: () => new Date('2026-07-15T12:00:00Z') };

/** Repo paths served by retrieval after a sync of the current tree. */
async function indexedPaths(brainDir: string): Promise<string[]> {
  const index = await openIndex({ dbPath: ':memory:', embedder: null });
  cleanups.push(() => index.close());
  await syncIndexWithCodemap(index, brainDir, { enabled: true });
  const docs = index.contextDocs({ sources: ['codemap'] });
  return docs.map((doc) => doc.id).sort();
}

describe('updateCodemap orphan sweep (R16.1 T5 — strict projection)', () => {
  it('added file → new entry appears, indexed, searchable', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    writeFileSync(join(repoRoot, 'src', 'added.ts'), 'export const n = 2;\n');
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });
    expect(result.summarized).toEqual(['src/added.ts']);
    expect(result.orphaned).toEqual([]);
    expect(await indexedPaths(brainDir)).toEqual([
      'cm:src/a.ts',
      'cm:src/added.ts',
    ]);
  });

  it('renamed file (delete + add) → old entry gone from disk AND retrieval, no cm:old survives', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    // git mv src/a.ts src/b.ts
    rmSync(join(repoRoot, 'src', 'a.ts'));
    writeFileSync(join(repoRoot, 'src', 'b.ts'), 'export const a = 1;\n');
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });

    expect(result.removed).toEqual(['src/a.ts']);
    expect(result.summarized).toEqual(['src/b.ts']);
    expect(
      existsSync(join(brainDir, 'codemap', 'files', 'src', 'a.ts.md')),
    ).toBe(false);
    expect(readCodemapEntries(brainDir).map((e) => e.path)).toEqual([
      'src/b.ts',
    ]);
    expect(await indexedPaths(brainDir)).toEqual(['cm:src/b.ts']);
  });

  it('renamed directory → every old entry gone, new ones exist, no empty directories remain', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    mkdirSync(join(repoRoot, 'src', 'payments'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'src', 'payments', 'retry.ts'),
      'export const r = 1;\n',
    );
    writeFileSync(
      join(repoRoot, 'src', 'payments', 'charge.ts'),
      'export const c = 1;\n',
    );
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    // src/payments/ → src/billing/
    mkdirSync(join(repoRoot, 'src', 'billing'), { recursive: true });
    for (const name of ['retry.ts', 'charge.ts']) {
      writeFileSync(
        join(repoRoot, 'src', 'billing', name),
        `export const x = '${name}';\n`,
      );
      rmSync(join(repoRoot, 'src', 'payments', name));
    }
    rmSync(join(repoRoot, 'src', 'payments'), { recursive: true });
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });

    expect(result.removed).toEqual([
      'src/payments/charge.ts',
      'src/payments/retry.ts',
    ]);
    expect(readCodemapEntries(brainDir).map((e) => e.path)).toEqual([
      'src/billing/charge.ts',
      'src/billing/retry.ts',
    ]);
    // The emptied directory is pruned from the entry tree.
    expect(
      existsSync(join(brainDir, 'codemap', 'files', 'src', 'payments')),
    ).toBe(false);
    expect(await indexedPaths(brainDir)).toEqual([
      'cm:src/billing/charge.ts',
      'cm:src/billing/retry.ts',
    ]);
  });

  it('corrupt manifest → the run rebuilds AND sweeps the stale entry (D1)', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repoRoot, 'src', 'gone.ts'), 'export const g = 1;\n');
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    // The file disappears AND the manifest is corrupted: the old delete path
    // (iterate old-manifest keys) had zero paths to remove here.
    rmSync(join(repoRoot, 'src', 'gone.ts'));
    writeFileSync(
      join(brainDir, 'codemap', 'manifest.json'),
      '{not json at all',
      'utf8',
    );

    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });
    // Rebuild: the surviving file is re-summarized (manifest was lost)…
    expect(result.summarized).toEqual(['src/a.ts']);
    // …and the stale entry is swept as an orphan (old manifest listed nothing).
    expect(result.orphaned).toEqual(['src/gone.ts']);
    expect(
      existsSync(join(brainDir, 'codemap', 'files', 'src', 'gone.ts.md')),
    ).toBe(false);
    expect(readCodemapManifest(brainDir).files['src/gone.ts']).toBeUndefined();
    expect(await indexedPaths(brainDir)).toEqual(['cm:src/a.ts']);
  });

  it('a stray entry no manifest ever produced is swept as an orphan', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    // Simulates a failed delete from an earlier run / manual tree damage.
    const stray = join(brainDir, 'codemap', 'files', 'src', 'stray.ts.md');
    writeFileSync(
      stray,
      serializeCodemapEntry({
        frontmatter: {
          v: 1,
          path: 'src/stray.ts',
          hash: 'b'.repeat(64),
          updated: '2026-07-01',
        },
        body: 'Stale summary of a file that no longer exists.',
      }),
      'utf8',
    );
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });
    expect(result.orphaned).toEqual(['src/stray.ts']);
    expect(result.removed).toEqual([]);
    expect(existsSync(stray)).toBe(false);
    expect(await indexedPaths(brainDir)).toEqual(['cm:src/a.ts']);
  });

  it('idempotence: two runs with no source change → no work, no disk churn, no reindex', async () => {
    const { repoRoot, brainDir } = scratchRepo();
    mkdirSync(join(repoRoot, 'src', 'deep', 'nest'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'src', 'deep', 'nest', 'a.ts'),
      'export const a = 1;\n',
    );
    await updateCodemap({ repoRoot, brainDir, provider: provider(), ...NOW });

    const index = await openIndex({ dbPath: ':memory:', embedder: null });
    cleanups.push(() => index.close());
    const first = await syncIndexWithCodemap(index, brainDir, {
      enabled: true,
    });
    expect(first.reindexed).toBe(true);

    const again = await updateCodemap({
      repoRoot,
      brainDir,
      provider: provider(),
      ...NOW,
    });
    expect(again.summarized).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.orphaned).toEqual([]);
    expect(again.unchanged).toBe(1);
    // No disk churn: the checksum-gated index sync sees nothing to do.
    const second = await syncIndexWithCodemap(index, brainDir, {
      enabled: true,
    });
    expect(second.reindexed).toBe(false);
    // The nested directory structure is untouched (no over-eager pruning).
    expect(
      readdirSync(join(brainDir, 'codemap', 'files', 'src', 'deep', 'nest')),
    ).toEqual(['a.ts.md']);
  });
});
