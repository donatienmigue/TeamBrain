import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HashingEmbedder } from '../embeddings.js';
import { openIndex } from '../store.js';
import { syncIndexWithBrain } from '../brain.js';
import { loadGoldenQueries } from '../golden-queries.js';
import { generateSyntheticBrain, writeSyntheticBrain } from '../synthetic.js';

// M3.4 `pnpm bench`. Performance budgets are tests: this script exits
// non-zero when search p95 ≥ 300ms, index rebuild ≥ 60s, or recall@8 <
// 0.85 on the golden query set. Runs fully offline (HashingEmbedder), so
// CI needs no model download and no network.

const SEARCH_P95_BUDGET_MS = 300;
const REBUILD_BUDGET_MS = 60_000;
const RECALL_AT_8_FLOOR = 0.85;
const RUNS_PER_QUERY = 8;

// dist/bench/run.js → repo root is four levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const GOLDEN_QUERIES_PATH = join(REPO_ROOT, 'testdata', 'golden-queries.yaml');

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] as number;
}

async function main(): Promise<void> {
  const golden = await loadGoldenQueries(GOLDEN_QUERIES_PATH);
  const workDir = await mkdtemp(join(tmpdir(), 'teambrain-bench-'));
  const failures: string[] = [];
  try {
    const brainDir = join(workDir, 'brain');
    const { memories, goldenIds } = generateSyntheticBrain({
      seed: golden.seed,
      count: golden.count,
    });
    await writeSyntheticBrain(brainDir, memories);
    console.log(
      `synthetic brain: ${memories.length} memories (seed ${golden.seed})`,
    );

    // Fixture ↔ generator sanity: the YAML must pin the ids this seed makes.
    for (const entry of golden.queries) {
      if (goldenIds[entry.key] !== entry.expected_id) {
        failures.push(
          `golden fixture drift: key ${entry.key} expects ${entry.expected_id} ` +
            `but generator produced ${goldenIds[entry.key] ?? 'nothing'} — ` +
            `regenerate testdata/golden-queries.yaml`,
        );
      }
    }

    const index = await openIndex({
      dbPath: join(workDir, 'index.db'),
      embedder: new HashingEmbedder(),
    });
    try {
      const rebuildStart = performance.now();
      const sync = await syncIndexWithBrain(index, brainDir, { force: true });
      const rebuildMs = performance.now() - rebuildStart;
      console.log(
        `rebuild: ${sync.docCount} docs in ${(rebuildMs / 1000).toFixed(1)}s ` +
          `(budget ${REBUILD_BUDGET_MS / 1000}s)`,
      );
      if (rebuildMs >= REBUILD_BUDGET_MS) {
        failures.push(
          `index rebuild took ${rebuildMs.toFixed(0)}ms ≥ ${REBUILD_BUDGET_MS}ms`,
        );
      }
      const stats = index.stats();
      if (stats.lexicalOnly) {
        failures.push('bench ran lexical-only; vector path not exercised');
      }

      let hits = 0;
      const latencies: number[] = [];
      for (const entry of golden.queries) {
        for (let run = 0; run < RUNS_PER_QUERY; run++) {
          const searchStart = performance.now();
          const results = await index.search(entry.query, 8);
          latencies.push(performance.now() - searchStart);
          if (
            run === 0 &&
            results.some((doc) => doc.id === entry.expected_id)
          ) {
            hits += 1;
          }
        }
      }
      const recall = hits / golden.queries.length;
      const p95 = percentile(latencies, 0.95);
      console.log(
        `search: p95 ${p95.toFixed(1)}ms over ${latencies.length} runs ` +
          `(budget ${SEARCH_P95_BUDGET_MS}ms)`,
      );
      console.log(
        `recall@8: ${recall.toFixed(2)} (${hits}/${golden.queries.length}, ` +
          `floor ${RECALL_AT_8_FLOOR})`,
      );
      if (p95 >= SEARCH_P95_BUDGET_MS) {
        failures.push(
          `search p95 ${p95.toFixed(1)}ms ≥ ${SEARCH_P95_BUDGET_MS}ms`,
        );
      }
      if (recall < RECALL_AT_8_FLOOR) {
        failures.push(`recall@8 ${recall.toFixed(2)} < ${RECALL_AT_8_FLOOR}`);
      }
    } finally {
      index.close();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`BENCH FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('bench: all budgets met');
  }
}

main().catch((err: unknown) => {
  console.error('bench crashed:', err);
  process.exitCode = 1;
});
