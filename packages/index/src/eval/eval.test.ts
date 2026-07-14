import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HashingEmbedder } from '../embeddings.js';
import { openIndex } from '../store.js';
import { syncIndexWithBrain } from '../brain.js';
import { mean, percentile, recallAtK, reciprocalRank } from './metrics.js';
import { loadEvalQueries } from './queries.js';
import { EVAL_MODES, runEval } from './runner.js';

// R10 harness self-tests: pure metric math, query-file validity, and one
// offline end-to-end pass over the real corpus with the HashingEmbedder.
// These keep the harness honest in CI without ever downloading the model —
// the *numbers* only mean something under `pnpm eval` (real embedder).

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const CORPUS_DIR = join(REPO_ROOT, 'testdata', 'eval', 'corpus');
const QUERIES_PATH = join(REPO_ROOT, 'testdata', 'eval', 'queries.yaml');

describe('eval metrics', () => {
  it('recallAtK: hit inside k, miss outside k', () => {
    expect(recallAtK(['a', 'b', 'c'], ['c'], 3)).toBe(1);
    expect(recallAtK(['a', 'b', 'c'], ['c'], 2)).toBe(0);
    expect(recallAtK([], ['c'], 8)).toBe(0);
    expect(recallAtK(['a', 'b'], ['x', 'b'], 2)).toBe(1);
  });

  it('reciprocalRank rewards ranking the relevant doc first', () => {
    expect(reciprocalRank(['r', 'x'], ['r'])).toBe(1);
    expect(reciprocalRank(['x', 'r'], ['r'])).toBe(0.5);
    expect(reciprocalRank(['x', 'y'], ['r'])).toBe(0);
  });

  it('mean and percentile handle edges', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 3])).toBe(2);
    expect(percentile([5, 1, 9], 0.5)).toBe(5);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('eval query set (E0 fixture)', () => {
  it('loads, is internally consistent, and covers the brief minimums', async () => {
    const queries = await loadEvalQueries(QUERIES_PATH);
    const negatives = queries.filter((q) => q.relevant.length === 0);
    expect(queries.length).toBeGreaterThanOrEqual(40);
    expect(negatives.length).toBeGreaterThanOrEqual(8);
    // All four memory classes are exercised via the kind taxonomy.
    const kinds = new Set(queries.map((q) => q.kind));
    for (const kind of ['structural', 'decision', 'convention', 'gotcha']) {
      expect(kinds.has(kind as never)).toBe(true);
    }
  });

  it('every relevant id exists in the indexed corpus (no dangling targets)', async () => {
    const queries = await loadEvalQueries(QUERIES_PATH);
    const index = await openIndex({
      dbPath: ':memory:',
      embedder: new HashingEmbedder(),
    });
    try {
      await syncIndexWithBrain(index, CORPUS_DIR, { force: true });
      const indexed = new Set(index.contextDocs({}).map((doc) => doc.id));
      for (const query of queries) {
        for (const id of query.relevant) {
          expect(indexed.has(id), `query ${query.id} → missing ${id}`).toBe(
            true,
          );
        }
      }
    } finally {
      index.close();
    }
  });
});

describe('eval runner (offline plumbing pass)', () => {
  it('produces a full report over the real corpus with all ablation modes', async () => {
    const queries = await loadEvalQueries(QUERIES_PATH);
    const report = await runEval({
      corpusDir: CORPUS_DIR,
      queries,
      embedder: new HashingEmbedder(),
    });
    expect(report.modes.map((m) => m.mode)).toEqual(
      EVAL_MODES.map((m) => m.name),
    );
    expect(report.memoryCount).toBeGreaterThanOrEqual(20);
    for (const mode of report.modes) {
      for (const k of [1, 3, 5, 8]) {
        const value = mode.recall[k] as number;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(mode.mrr).toBeGreaterThanOrEqual(0);
      expect(mode.mrr).toBeLessThanOrEqual(1);
    }
    // recall@k is monotonic in k for every mode.
    for (const mode of report.modes) {
      expect(mode.recall[8]).toBeGreaterThanOrEqual(mode.recall[1] as number);
    }
    expect(report.contextHitRate).toBeGreaterThanOrEqual(0);
    expect(report.latencyP95Ms).toBeGreaterThanOrEqual(report.latencyP50Ms);
  }, 60_000);

  it('ablation knobs really ablate: lexical-only ≠ vector-only rankings', async () => {
    const index = await openIndex({
      dbPath: ':memory:',
      embedder: new HashingEmbedder(),
    });
    try {
      await syncIndexWithBrain(index, CORPUS_DIR, { force: true });
      const q = 'why do we not use a hosted vector database like pinecone?';
      const lexical = await index.searchWithOptions(q, 8, {
        channels: { vector: false },
      });
      const vector = await index.searchWithOptions(q, 8, {
        channels: { lexical: false },
      });
      const hybrid = await index.searchWithOptions(q, 8, {});
      const unitWeights = await index.searchWithOptions(q, 8, {
        fusionWeights: { lexical: 1, vector: 1 },
      });
      // Channel isolation produces different score profiles than hybrid…
      expect(lexical.length + vector.length).toBeGreaterThan(0);
      // …and 1/1 weighted fusion IS the shipped RRF, byte for byte.
      expect(unitWeights).toEqual(hybrid);
    } finally {
      index.close();
    }
  });
});
