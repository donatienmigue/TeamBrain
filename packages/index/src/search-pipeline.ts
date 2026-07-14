import type { Scored } from './types.js';

// M3.3 pure pipeline stages (C4): BM25 top-40 ∪ vector top-40 → RRF(k=60)
// → filters → required force-include → token-budget trim. The SQL halves
// live in store.ts; everything unit-testable without a database lives here.

export const LEXICAL_TOP_N = 40;
export const VECTOR_TOP_N = 40;
export const RRF_K = 60;
/** C4 token estimate: 4 chars per token. */
export const CHARS_PER_TOKEN = 4;

/**
 * Builds a safe FTS5 MATCH expression from free text: bare terms are
 * extracted and double-quoted (so FTS5 operators, punctuation, and column
 * syntax in user queries cannot alter or crash the query), then OR-joined.
 * Returns null when the query holds no indexable term.
 */
export function toFtsMatchExpression(query: string): string | null {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(' OR ');
}

/**
 * Reciprocal-rank fusion: each ranked list contributes 1/(k+rank) per item,
 * rank starting at 1. Items appearing in both lists sum both contributions.
 * Optional per-list `weights` (default 1 each — plain RRF, the shipped
 * behavior) exist for the R10 eval harness's weighted-fusion ablation.
 */
export function rrfFuse(
  rankedLists: ReadonlyArray<ReadonlyArray<number>>,
  k = RRF_K,
  weights?: ReadonlyArray<number>,
): Map<number, number> {
  const fusedScores = new Map<number, number>();
  for (let listIndex = 0; listIndex < rankedLists.length; listIndex++) {
    const list = rankedLists[listIndex] as ReadonlyArray<number>;
    const weight = weights?.[listIndex] ?? 1;
    for (let rank = 1; rank <= list.length; rank++) {
      const item = list[rank - 1] as number;
      fusedScores.set(
        item,
        (fusedScores.get(item) ?? 0) + weight * (1 / (k + rank)),
      );
    }
  }
  return fusedScores;
}

/** TTL filter: a doc with created+ttl_days in the past is expired. */
export function isExpired(
  created: string | undefined,
  ttlDays: number | null | undefined,
  now: Date,
): boolean {
  if (ttlDays === null || ttlDays === undefined || created === undefined) {
    return false;
  }
  const createdMs = Date.parse(`${created}T00:00:00Z`);
  if (Number.isNaN(createdMs)) return false;
  return createdMs + ttlDays * 24 * 60 * 60 * 1000 <= now.getTime();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function scoredTokens(doc: Scored): number {
  return estimateTokens(doc.title) + estimateTokens(doc.body);
}

/**
 * Final trim stage: drops lowest-ranked docs until the estimated token
 * total fits `budget`. Required docs are force-included and never dropped,
 * even when they alone exceed the budget (C4).
 */
export function applyTokenBudget(docs: Scored[], budget: number): Scored[] {
  let spentTokens = 0;
  const kept: Scored[] = [];
  const advisoryKeptIndexes: number[] = [];
  for (const doc of docs) {
    kept.push(doc);
    if (doc.priority !== 'required') {
      advisoryKeptIndexes.push(kept.length - 1);
    }
    spentTokens += scoredTokens(doc);
  }
  const dropped = new Set<number>();
  while (spentTokens > budget && advisoryKeptIndexes.length > 0) {
    const dropIndex = advisoryKeptIndexes.pop() as number;
    dropped.add(dropIndex);
    spentTokens -= scoredTokens(kept[dropIndex] as Scored);
  }
  return kept.filter((_, index) => !dropped.has(index));
}
