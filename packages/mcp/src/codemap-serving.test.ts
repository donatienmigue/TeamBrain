import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeCodemapEntry } from '@teambrain/core';
import { syncIndexWithCodemap, type SqliteIndex } from '@teambrain/index';
import {
  buildMemoryContext,
  renderContextBundle,
  renderCodemapIndexBlock,
  CODEMAP_TOKEN_BUDGET,
  CODEMAP_SCOPED_TOKEN_BUDGET,
  CODEMAP_INDEX_MAX_TOKENS,
  SESSION_CONTEXT_MAX_CHARS,
} from './context.js';
import { servesCodemap, filterSearchForArm } from './codemap-arm-serving.js';
import { openBackend } from './runtime.js';
import { createTools } from './tools.js';
import {
  fixtureBrainDir,
  indexForBrain,
  tempRuntimeDir,
  toolContextFor,
} from './test-helpers.js';

// D6 acceptance: the serving half of CodeMap. Budget isolation (governed
// memories never crowded out — the gated negative test), staleness (a
// changed/deleted entry stops serving after one sync), the disabled flag
// emptying the source, and memory_search transparency across sources.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const HASH = 'b'.repeat(64);

/** A scratch brain dir holding only a codemap tree. */
function codemapBrainDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-codemap-serve-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeEntry(brainDir: string, path: string, body: string): void {
  const file = join(brainDir, 'codemap', 'files', `${path}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    serializeCodemapEntry({
      frontmatter: { v: 1, path, hash: HASH, updated: '2026-07-10' },
      body,
    }),
    'utf8',
  );
}

async function fixtureIndex(): Promise<SqliteIndex> {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  return index;
}

describe('codemap serving (D6/R16)', () => {
  it('indexes entries under source codemap when enabled', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/http/router.ts', 'Routes HTTP requests.');

    const result = await syncIndexWithCodemap(index, brainDir, {
      enabled: true,
    });
    expect(result).toEqual({ reindexed: true, docCount: 1 });
    expect(index.stats().bySource.codemap).toBe(1);
    // Idempotent second sync (checksum match).
    const again = await syncIndexWithCodemap(index, brainDir, {
      enabled: true,
    });
    expect(again.reindexed).toBe(false);
  });

  it('negative: disabled flag empties the codemap source', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/a.ts', 'Summary A.');
    await syncIndexWithCodemap(index, brainDir, { enabled: true });
    expect(index.stats().bySource.codemap).toBe(1);

    await syncIndexWithCodemap(index, brainDir, { enabled: false });
    expect(index.stats().bySource.codemap).toBe(0);
    const results = await index.search('Summary A', 8, ['codemap']);
    expect(results).toEqual([]);
  });

  it('negative (budget isolation): codemap docs never displace governed memories', async () => {
    const index = await fixtureIndex();
    const before = buildMemoryContext(index, {
      now: new Date('2026-07-10T00:00:00Z'),
    });
    expect(before.required.length).toBeGreaterThan(0);

    // Flood the codemap source with far more content than its budget.
    const brainDir = codemapBrainDir();
    for (let i = 0; i < 30; i += 1) {
      writeEntry(
        brainDir,
        `src/mod${i}.ts`,
        'Lorem ipsum codemap. '.repeat(200),
      );
    }
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const after = buildMemoryContext(index, {
      now: new Date('2026-07-10T00:00:00Z'),
    });
    // The memory pools are byte-identical to the codemap-free run.
    expect(after.required).toEqual(before.required);
    expect(after.relevant.filter((view) => view.source === 'memory')).toEqual(
      before.relevant,
    );
    // The codemap slice exists but stays inside its own budget.
    const codemapViews = after.relevant.filter(
      (view) => view.source === 'codemap',
    );
    expect(codemapViews.length).toBeGreaterThan(0);
    const codemapTokens = codemapViews.reduce(
      (sum, view) =>
        sum + Math.ceil((view.title.length + view.body.length) / 4),
      0,
    );
    expect(codemapTokens).toBeLessThanOrEqual(CODEMAP_TOKEN_BUDGET);
  });

  it('negative (staleness): a changed or deleted entry stops serving after one sync', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/auth.ts', 'Old summary: uses session cookies.');
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    // Changed file → summary rewritten by the generator → next sync serves
    // the new text and never the old.
    writeEntry(brainDir, 'src/auth.ts', 'New summary: uses signed JWTs.');
    await syncIndexWithCodemap(index, brainDir, { enabled: true });
    const changed = await index.search('summary', 8, ['codemap']);
    expect(changed.map((r) => r.body).join(' ')).toContain('signed JWTs');
    expect(changed.map((r) => r.body).join(' ')).not.toContain(
      'session cookies',
    );

    // Deleted file → entry removed → gone from retrieval after one sync.
    rmSync(join(brainDir, 'codemap', 'files', 'src', 'auth.ts.md'));
    await syncIndexWithCodemap(index, brainDir, { enabled: true });
    expect(await index.search('summary', 8, ['codemap'])).toEqual([]);
  });

  it('memory_search transparently returns both sources, tagged (zero new tools)', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(
      brainDir,
      'src/zod-boundary.ts',
      'Validates external input with zod at the boundary.',
    );
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const runtimeDir = await tempRuntimeDir(cleanups);
    const tools = createTools(toolContextFor(index, runtimeDir));
    const results = await tools.memorySearch({ query: 'zod boundary input' });

    const sources = new Set(results.map((view) => view.source));
    expect(sources.has('memory')).toBe(true);
    expect(sources.has('codemap')).toBe(true);
    const codemapHit = results.find((view) => view.source === 'codemap');
    expect(codemapHit?.id).toBe('cm:src/zod-boundary.ts');
    expect(codemapHit?.provenance).toBe('src/zod-boundary.ts');
  });

  it('R16.1 P2: non-empty codemap → the index block + instruction ride in the preamble region', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/payments/retry.ts', 'Retries webhooks.');
    writeEntry(brainDir, 'src/auth/session.ts', 'Session auth.');
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const stats = index.codemapStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.modules.sort()).toEqual(['src/auth', 'src/payments']);

    const bundle = renderContextBundle(
      buildMemoryContext(index),
      SESSION_CONTEXT_MAX_CHARS,
      stats,
    );
    // The index block is present, with the behavioral instruction…
    expect(bundle).toContain('CodeMap: this repo has a generated map of 2');
    expect(bundle).toContain('search the map');
    expect(bundle).toContain('memory_search(');
    // …in the preamble region: before the first fenced block, never inside one.
    const firstFence = bundle.indexOf('```');
    expect(bundle.indexOf('CodeMap: this repo')).toBeLessThan(firstFence);

    // Compact: the index block itself stays ≤ 200 tokens (4 chars/token).
    const block = renderCodemapIndexBlock(stats);
    expect(block).not.toBeNull();
    expect(Math.ceil((block as string).length / 4)).toBeLessThanOrEqual(
      CODEMAP_INDEX_MAX_TOKENS,
    );
  });

  it('negative (R16.1 P2): empty codemap → bundle byte-identical to today', async () => {
    const index = await fixtureIndex();
    const context = buildMemoryContext(index);
    const withoutStats = renderContextBundle(context);
    // Both the "no stats supplied" and the "empty stats" paths are identical.
    expect(renderContextBundle(context, SESSION_CONTEXT_MAX_CHARS, null)).toBe(
      withoutStats,
    );
    expect(
      renderContextBundle(
        context,
        SESSION_CONTEXT_MAX_CHARS,
        index.codemapStats(),
      ),
    ).toBe(withoutStats);
    expect(withoutStats).not.toContain('CodeMap:');
  });

  it('R16.1 P1: session paths scope the slice — payments work gets payments maps, not the newest file', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(
      brainDir,
      'src/payments/retry.ts',
      'Retries webhook deliveries.',
    );
    // The unrelated entry is NEWER — under V1 ordering it would win the slice.
    const file = join(brainDir, 'codemap', 'files', 'docs-tooling.ts.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      serializeCodemapEntry({
        frontmatter: {
          v: 1,
          path: 'docs-tooling.ts',
          hash: HASH,
          updated: '2026-07-14',
        },
        body: 'Unrelated recently-changed tooling file.',
      }),
      'utf8',
    );
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const context = buildMemoryContext(index, {
      now: new Date('2026-07-15T00:00:00Z'),
      paths: ['src/payments/retry.ts'],
    });
    const codemapViews = context.relevant.filter((v) => v.source === 'codemap');
    expect(codemapViews.map((v) => v.id)).toEqual(['cm:src/payments/retry.ts']);
    expect(context.relevant.some((v) => v.id === 'cm:docs-tooling.ts')).toBe(
      false,
    );
  });

  it('R16.1 P1: no session signal (paths: []) → no slice; the bundle carries only the index block', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/a.ts', 'Module A summary.');
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const context = buildMemoryContext(index, { paths: [] });
    expect(context.relevant.some((v) => v.source === 'codemap')).toBe(false);

    const bundle = renderContextBundle(
      context,
      SESSION_CONTEXT_MAX_CHARS,
      index.codemapStats(),
    );
    expect(bundle).toContain('CodeMap: this repo has a generated map');
    expect(bundle).not.toContain('[codemap ·'); // no fenced codemap block
    expect(bundle).not.toContain('Module A summary.');
  });

  it('R16.1 P1: session-start codemap footprint stays ≤ ~700 tokens (index + scoped slice)', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    const paths: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const path = `src/mod${i}.ts`;
      writeEntry(brainDir, path, 'Long module summary. '.repeat(60));
      paths.push(path);
    }
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const context = buildMemoryContext(index, { paths });
    const sliceTokens = context.relevant
      .filter((v) => v.source === 'codemap')
      .reduce(
        (sum, v) => sum + Math.ceil((v.title.length + v.body.length) / 4),
        0,
      );
    expect(sliceTokens).toBeLessThanOrEqual(CODEMAP_SCOPED_TOKEN_BUDGET);
    const indexBlock = renderCodemapIndexBlock(index.codemapStats());
    const indexTokens = Math.ceil((indexBlock as string).length / 4);
    expect(sliceTokens + indexTokens).toBeLessThanOrEqual(700);
  });

  it('R16.1 T7b: servesCodemap keys the bypass — control drops codemap, sid-less serves', () => {
    // Deterministic edges: holdout 1 → always control (no serve); holdout 0 →
    // always treatment (serve); no sid → treatment (bare memory_context call).
    expect(servesCodemap('any-sid', 1)).toBe(false);
    expect(servesCodemap('any-sid', 0)).toBe(true);
    expect(servesCodemap(undefined, 0.5)).toBe(true);
    expect(servesCodemap('', 0.5)).toBe(true);
  });

  it('R16.1 T7b: a control-arm bundle is byte-identical to the empty-codemap bundle', async () => {
    const now = new Date('2026-07-15T00:00:00Z');
    // An index WITH codemap docs, and a second identical-memory index without.
    const withCodemap = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(brainDir, 'src/payments/retry.ts', 'Retries webhooks.');
    writeEntry(brainDir, 'src/auth/session.ts', 'Session auth.');
    await syncIndexWithCodemap(withCodemap, brainDir, { enabled: true });
    expect(withCodemap.codemapStats().entryCount).toBe(2);
    const codemapFree = await fixtureIndex();

    // The daemon renders a control session with paths:[] (no slice) and null
    // stats (no index block) — exactly the codemap-off render.
    const controlBundle = renderContextBundle(
      buildMemoryContext(withCodemap, { now, paths: [] }),
      SESSION_CONTEXT_MAX_CHARS,
      null,
    );
    const emptyBundle = renderContextBundle(
      buildMemoryContext(codemapFree, { now }),
      SESSION_CONTEXT_MAX_CHARS,
      codemapFree.codemapStats(),
    );
    expect(controlBundle).toBe(emptyBundle);
    expect(controlBundle).not.toContain('CodeMap:');
    expect(controlBundle).not.toContain('[codemap ·');

    // …and a treatment render of the same index is NOT the empty bundle.
    const treatmentBundle = renderContextBundle(
      buildMemoryContext(withCodemap, {
        now,
        paths: ['src/payments/retry.ts'],
      }),
      SESSION_CONTEXT_MAX_CHARS,
      withCodemap.codemapStats(),
    );
    expect(treatmentBundle).toContain('CodeMap:');
    expect(treatmentBundle).not.toBe(controlBundle);
  });

  it('R16.1 T7b: memory_search excludes codemap for a control session, keeps it for treatment', async () => {
    const index = await fixtureIndex();
    const brainDir = codemapBrainDir();
    writeEntry(
      brainDir,
      'src/zod-boundary.ts',
      'Validates external input with zod at the boundary.',
    );
    await syncIndexWithCodemap(index, brainDir, { enabled: true });

    const runtimeDir = await tempRuntimeDir(cleanups);
    const tools = createTools(toolContextFor(index, runtimeDir));
    const results = await tools.memorySearch({ query: 'zod boundary input' });
    expect(results.some((v) => v.source === 'codemap')).toBe(true);

    // Control (serve=false) strips codemap; treatment (serve=true) is unchanged.
    const control = filterSearchForArm(results, false);
    expect(control.some((v) => v.source === 'codemap')).toBe(false);
    expect(control.every((v) => v.source === 'memory')).toBe(true);
    expect(filterSearchForArm(results, true)).toEqual(results);
  });

  it('e2e both modes: openBackend serves codemap iff brain.yaml enables it', async () => {
    const brainDir = codemapBrainDir();
    mkdirSync(join(brainDir, 'memories'), { recursive: true });
    writeEntry(brainDir, 'src/core.ts', 'The core module summary.');

    for (const enabled of [false, true]) {
      writeFileSync(
        join(brainDir, 'brain.yaml'),
        `version: 1\ncodemap:\n  enabled: ${enabled}\n`,
      );
      const runtimeDir = await tempRuntimeDir(cleanups);
      const handle = await openBackend({
        runtimeDir,
        brainDir,
        embedder: null, // offline
      });
      cleanups.push(() => handle.close());
      expect(handle.index.stats().bySource.codemap).toBe(enabled ? 1 : 0);
      const context = buildMemoryContext(handle.context.backend);
      const codemapViews = context.relevant.filter(
        (view) => view.source === 'codemap',
      );
      expect(codemapViews.length).toBe(enabled ? 1 : 0);
    }
  });
});
