import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HashingEmbedder } from './embeddings.js';
import { openIndex, type SqliteIndex } from './store.js';
import { captureLogger, makeDoc } from './test-helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function memoryIndex(
  options: { embedder?: HashingEmbedder | null } = {},
): Promise<SqliteIndex> {
  const index = await openIndex({
    dbPath: ':memory:',
    embedder: 'embedder' in options ? options.embedder : new HashingEmbedder(),
  });
  cleanups.push(() => index.close());
  return index;
}

describe('SqliteIndex store (M3.1)', () => {
  it('indexes, searches, and reports stats', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({ id: 'a', title: 'Redis token bucket rate limiter' }),
        makeDoc({ id: 'b', title: 'Parquet daily partitions' }),
      ],
      'memory',
    );
    const stats = index.stats();
    expect(stats.docCount).toBe(2);
    expect(stats.bySource.memory).toBe(2);
    expect(stats.vectorCount).toBe(2);
    expect(stats.lexicalOnly).toBe(false);
    expect(stats.vectorDim).toBe(384);

    const results = await index.search('redis rate limiter', 8);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.source).toBe('memory');
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('upserts by id: the FTS mirror reflects the newest body', async () => {
    // Lexical-only: vector KNN would legitimately return any nearest doc,
    // which is not what this test isolates (the FTS mirror sync).
    const index = await memoryIndex({ embedder: null });
    await index.index(
      [
        makeDoc({
          id: 'a',
          title: 'About zebras',
          body: 'zebras have stripes',
        }),
      ],
      'memory',
    );
    await index.index(
      [makeDoc({ id: 'a', title: 'About otters', body: 'otters swim rivers' })],
      'memory',
    );
    expect(index.stats().docCount).toBe(1);
    expect(await index.search('zebras stripes', 8)).toHaveLength(0);
    const results = await index.search('otters rivers', 8);
    expect(results.map((doc) => doc.id)).toEqual(['a']);
  });

  it('remove drops a doc from lexical and vector search', async () => {
    const index = await memoryIndex();
    await index.index(
      [makeDoc({ id: 'a', title: 'Unique walrus fact', body: 'walrus tusks' })],
      'memory',
    );
    await index.remove(['a', 'never-existed']);
    expect(index.stats().docCount).toBe(0);
    expect(index.stats().vectorCount).toBe(0);
    expect(await index.search('walrus tusks', 8)).toHaveLength(0);
  });

  it('persists across close/reopen without re-embedding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-index-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'index.db');
    const first = await openIndex({ dbPath, embedder: new HashingEmbedder() });
    await first.index(
      [makeDoc({ id: 'a', title: 'Persistent yak' })],
      'memory',
    );
    first.close();

    const second = await openIndex({ dbPath, embedder: new HashingEmbedder() });
    cleanups.push(() => second.close());
    expect(second.stats().docCount).toBe(1);
    expect(second.stats().vectorCount).toBe(1);
    const results = await second.search('persistent yak', 8);
    expect(results.map((doc) => doc.id)).toEqual(['a']);
  });

  it('re-embeds existing docs when the embedder changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-index-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'index.db');
    const first = await openIndex({
      dbPath,
      embedder: new HashingEmbedder(128),
    });
    await first.index(
      [makeDoc({ id: 'a', title: 'Dimension shift' })],
      'memory',
    );
    expect(first.stats().vectorDim).toBe(128);
    first.close();

    const logger = captureLogger();
    const second = await openIndex({
      dbPath,
      embedder: new HashingEmbedder(384),
      logger,
    });
    cleanups.push(() => second.close());
    expect(second.stats().vectorDim).toBe(384);
    expect(second.stats().vectorCount).toBe(1);
    expect(
      logger.entries.some((entry) => entry.msg.includes('re-embedding')),
    ).toBe(true);
  });

  it('rejects docs that fail boundary validation', async () => {
    const index = await memoryIndex();
    await expect(
      index.index([makeDoc({ id: '' })], 'memory'),
    ).rejects.toThrow();
  });
});

describe('lexical-only degrade (principle 2)', () => {
  it('works without an embedder and says so in stats', async () => {
    const index = await memoryIndex({ embedder: null });
    await index.index(
      [makeDoc({ id: 'a', title: 'Lexical only llama', body: 'llama wool' })],
      'memory',
    );
    const stats = index.stats();
    expect(stats.lexicalOnly).toBe(true);
    expect(stats.vectorCount).toBe(0);
    expect(stats.vectorDim).toBeNull();
    const results = await index.search('llama wool', 8);
    expect(results.map((doc) => doc.id)).toEqual(['a']);
  });
});

describe('hybrid search pipeline (M3.3, C4)', () => {
  it('fuses lexical and vector rankings (hybrid beats single-list)', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'both',
          title: 'Webhook retries use exponential backoff',
          body: 'Webhook delivery retries with exponential backoff and jitter.',
        }),
        makeDoc({
          id: 'other',
          title: 'Unrelated invoicing notes',
          body: 'Completely different topic about invoices.',
        }),
      ],
      'memory',
    );
    const results = await index.search('webhook retry backoff', 8);
    expect(results[0]?.id).toBe('both');
  });

  it('excludes retired docs from retrieval (negative test)', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'retired',
          title: 'Retired kangaroo convention',
          body: 'kangaroo hopping rules',
          status: 'retired',
        }),
        makeDoc({
          id: 'active',
          title: 'Active kangaroo convention',
          body: 'kangaroo hopping rules',
        }),
      ],
      'memory',
    );
    const results = await index.search('kangaroo hopping', 8);
    expect(results.map((doc) => doc.id)).toEqual(['active']);
  });

  it('excludes TTL-expired docs using the injected clock', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'expired',
          title: 'Ephemeral flamingo notice',
          body: 'flamingo migration window',
          created: '2026-01-01',
          ttl_days: 30,
        }),
        makeDoc({
          id: 'fresh',
          title: 'Fresh flamingo notice',
          body: 'flamingo migration window',
          created: '2026-06-20',
          ttl_days: 30,
        }),
      ],
      'memory',
    );
    const results = await index.searchWithOptions('flamingo migration', 8, {
      now: new Date('2026-07-04T00:00:00Z'),
    });
    expect(results.map((doc) => doc.id)).toEqual(['fresh']);
  });

  it('filters by scope when requested', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({ id: 'team', title: 'Pelican protocol', scope: 'team' }),
        makeDoc({ id: 'org', title: 'Pelican protocol', scope: 'org' }),
      ],
      'memory',
    );
    const results = await index.searchWithOptions('pelican protocol', 8, {
      scope: 'org',
    });
    expect(results.map((doc) => doc.id)).toEqual(['org']);
  });

  it('plain search does not inject non-matching required docs', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'req',
          title: 'Required tax rules',
          body: 'taxes',
          priority: 'required',
        }),
        makeDoc({ id: 'hit', title: 'Ostrich handbook', body: 'ostrich care' }),
      ],
      'memory',
    );
    // k=1: were force-include active, 'req' would appear despite the cap.
    const results = await index.search('ostrich care', 1);
    expect(results.map((doc) => doc.id)).toEqual(['hit']);
  });

  it('context assembly force-includes required docs first, exempt from trim', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'req',
          title: 'Required tax rules',
          body: 'taxes must always be handled by the shared module',
          priority: 'required',
        }),
        makeDoc({
          id: 'hit',
          title: 'Ostrich handbook',
          body: 'ostrich care '.repeat(100),
        }),
      ],
      'memory',
    );
    const results = await index.searchWithOptions('ostrich care', 8, {
      tokenBudget: 40,
    });
    // Required doc survives although it matched nothing and the budget is
    // too small for both docs; the advisory hit is trimmed.
    expect(results.map((doc) => doc.id)).toEqual(['req']);
  });

  it('force-include never resurrects retired or expired required docs', async () => {
    const index = await memoryIndex();
    await index.index(
      [
        makeDoc({
          id: 'retired-req',
          title: 'Retired required rule',
          priority: 'required',
          status: 'retired',
        }),
        makeDoc({
          id: 'expired-req',
          title: 'Expired required rule',
          priority: 'required',
          created: '2026-01-01',
          ttl_days: 10,
        }),
        makeDoc({ id: 'hit', title: 'Muskox field notes', body: 'muskox' }),
      ],
      'memory',
    );
    const results = await index.searchWithOptions('muskox', 8, {
      tokenBudget: 2000,
      now: new Date('2026-07-04T00:00:00Z'),
    });
    expect(results.map((doc) => doc.id)).toEqual(['hit']);
  });

  it('caps advisory results at k', async () => {
    const index = await memoryIndex();
    await index.index(
      Array.from({ length: 10 }, (_, i) =>
        makeDoc({ id: `n${i}`, title: 'Numbat notes', body: 'numbat habits' }),
      ),
      'memory',
    );
    expect(await index.search('numbat habits', 3)).toHaveLength(3);
  });

  it('hostile query strings neither crash nor match everything', async () => {
    const index = await memoryIndex();
    await index.index([makeDoc({ id: 'a', title: 'Quokka guide' })], 'memory');
    expect(await index.search('"unclosed AND (title: *', 8)).toBeDefined();
    expect(await index.search('', 8)).toHaveLength(0);
  });
});
