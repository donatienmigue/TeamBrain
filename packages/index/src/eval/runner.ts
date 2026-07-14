import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Embedder } from '../embeddings.js';
import { openIndex } from '../store.js';
import { syncIndexWithBrain } from '../brain.js';
import type { SearchOptions } from '../types.js';
import type { EvalQuery } from './queries.js';
import { mean, percentile, recallAtK, reciprocalRank } from './metrics.js';

// R10 eval runner (Tech Brief §3): index the real corpus with a given
// embedder, replay the query set under each ablation mode, and compute
// recall@k / MRR / negative precision / context hit-rate / latency.
// Deliberately NOT part of `pnpm bench` (§3.5): bench is the fast offline
// CI gate; this is a measurement a human runs on demand via `pnpm eval`.

export const RECALL_KS = [1, 3, 5, 8] as const;
export const EVAL_SEARCH_K = 8;
/** C3 memory_context token budget (frozen; mirrored from CONTRACTS C3). */
export const CONTEXT_TOKEN_BUDGET = 2000;
/**
 * Negatives threshold on the top-1 RRF score. RRF scores are rank-shaped:
 * rank-1 in one channel is 1/(60+1) ≈ 0.0164; rank-1 in both ≈ 0.0328.
 * τ = 0.02 therefore reads "both channels agree this is a strong match".
 * The shipped search path has NO abstention — it always returns top-k —
 * so this measures what a threshold gate *would* do, not current behavior.
 */
export const NEGATIVE_SCORE_THRESHOLD = 0.02;

export interface EvalMode {
  name: string;
  /** Ablation knobs applied on top of the shipped defaults. */
  options: Pick<SearchOptions, 'channels' | 'fusionWeights'>;
  shipped: boolean;
}

export const EVAL_MODES: EvalMode[] = [
  {
    name: 'lexical only (BM25)',
    options: { channels: { vector: false } },
    shipped: false,
  },
  {
    name: 'vector only',
    options: { channels: { lexical: false } },
    shipped: false,
  },
  { name: 'hybrid RRF (shipped)', options: {}, shipped: true },
  {
    name: 'hybrid weighted 0.7/0.3',
    options: { fusionWeights: { lexical: 0.7, vector: 0.3 } },
    shipped: false,
  },
];

export interface ModeResult {
  mode: string;
  shipped: boolean;
  recall: Record<number, number>;
  mrr: number;
  /** Fraction of negatives with no result scoring ≥ τ (higher = better). */
  negativePrecision: number;
  /** Fraction of negatives returning at least one result at all. */
  negativesReturningAnything: number;
}

export interface EvalReport {
  corpus: string;
  embedderId: string;
  memoryCount: number;
  positives: number;
  negatives: number;
  modes: ModeResult[];
  /** memory_context (C3 bundle) — fraction of positive queries whose needed
   *  memory was inside the assembled 2000-token bundle. */
  contextHitRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export interface RunEvalOptions {
  corpusDir: string;
  queries: EvalQuery[];
  embedder: Embedder;
  /** Label printed in the report header. */
  corpusLabel?: string;
}

export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const positives = options.queries.filter((q) => q.relevant.length > 0);
  const negatives = options.queries.filter((q) => q.relevant.length === 0);

  const workDir = await mkdtemp(join(tmpdir(), 'teambrain-eval-'));
  const index = await openIndex({
    dbPath: join(workDir, 'eval-index.db'),
    embedder: options.embedder,
  });
  try {
    const sync = await syncIndexWithBrain(index, options.corpusDir, {
      force: true,
    });
    if (index.stats().lexicalOnly) {
      throw new Error(
        'eval index came up lexical-only — the vector channel under test is missing',
      );
    }

    const modes: ModeResult[] = [];
    const latencies: number[] = [];
    for (const mode of EVAL_MODES) {
      const recallHits: Record<number, number[]> = {};
      for (const k of RECALL_KS) recallHits[k] = [];
      const rrs: number[] = [];
      for (const query of positives) {
        const started = performance.now();
        const results = await index.searchWithOptions(
          query.query,
          EVAL_SEARCH_K,
          mode.options,
        );
        if (mode.shipped) latencies.push(performance.now() - started);
        const rankedIds = results.map((doc) => doc.id);
        for (const k of RECALL_KS) {
          (recallHits[k] as number[]).push(
            recallAtK(rankedIds, query.relevant, k),
          );
        }
        rrs.push(reciprocalRank(rankedIds, query.relevant));
      }

      let negativesClean = 0;
      let negativesReturning = 0;
      for (const query of negatives) {
        const results = await index.searchWithOptions(
          query.query,
          EVAL_SEARCH_K,
          mode.options,
        );
        if (results.length > 0) negativesReturning += 1;
        const topScore = results[0]?.score ?? 0;
        if (topScore < NEGATIVE_SCORE_THRESHOLD) negativesClean += 1;
      }

      modes.push({
        mode: mode.name,
        shipped: mode.shipped,
        recall: Object.fromEntries(
          RECALL_KS.map((k) => [k, mean(recallHits[k] as number[])]),
        ),
        mrr: mean(rrs),
        negativePrecision:
          negatives.length === 0 ? 1 : negativesClean / negatives.length,
        negativesReturningAnything:
          negatives.length === 0 ? 0 : negativesReturning / negatives.length,
      });
    }

    // memory_context surface: the C3 bundle is query-less (required-first,
    // newest-first, token-trimmed) — measure whether the memory each session
    // needed made it into the bundle at the shipped 2000-token budget.
    const bundleIds = new Set(
      index
        .contextDocs({ tokenBudget: CONTEXT_TOKEN_BUDGET })
        .map((doc) => doc.id),
    );
    const contextHits = positives.filter((query) =>
      query.relevant.some((id) => bundleIds.has(id)),
    ).length;

    return {
      corpus: options.corpusLabel ?? options.corpusDir,
      embedderId: options.embedder.id,
      memoryCount: sync.docCount,
      positives: positives.length,
      negatives: negatives.length,
      modes,
      contextHitRate:
        positives.length === 0 ? 0 : contextHits / positives.length,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
    };
  } finally {
    index.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/** Renders the §2 report table as plain text. */
export function renderEvalReport(report: EvalReport): string {
  const shipped = report.modes.find((mode) => mode.shipped);
  let out = '';
  out += `corpus: ${report.corpus} (${report.memoryCount} memories)   `;
  out += `embedder: ${report.embedderId}\n`;
  out += `queries: ${report.positives} positive + ${report.negatives} negative\n\n`;
  out +=
    '                              recall@1  recall@3  recall@5  recall@8   MRR   neg-precision\n';
  for (const mode of report.modes) {
    const marker = mode.shipped ? '→' : ' ';
    const name = mode.mode.padEnd(28);
    out += `${marker} ${name}`;
    for (const k of RECALL_KS) out += `  ${fmt(mode.recall[k] ?? 0)}    `;
    out += ` ${fmt(mode.mrr)}      ${fmt(mode.negativePrecision)}\n`;
  }
  if (shipped !== undefined) {
    out += `\nnegatives returning ≥1 result (shipped, no abstention): ${fmt(
      shipped.negativesReturningAnything,
    )}\n`;
  }
  out += `memory_context hit-rate (${CONTEXT_TOKEN_BUDGET}-token bundle): ${fmt(
    report.contextHitRate,
  )}\n`;
  out += `latency (shipped mode): p50 ${report.latencyP50Ms.toFixed(1)}ms   `;
  out += `p95 ${report.latencyP95Ms.toFixed(1)}ms\n`;
  return out;
}
