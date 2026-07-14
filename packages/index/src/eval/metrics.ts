// R10 eval metrics — pure functions, unit-tested offline.

/** 1 when any relevant id appears in the top-k of `rankedIds`, else 0. */
export function recallAtK(
  rankedIds: ReadonlyArray<string>,
  relevant: ReadonlyArray<string>,
  k: number,
): 0 | 1 {
  const topK = rankedIds.slice(0, k);
  return relevant.some((id) => topK.includes(id)) ? 1 : 0;
}

/** 1/rank of the first relevant id (rank starts at 1); 0 when absent. */
export function reciprocalRank(
  rankedIds: ReadonlyArray<string>,
  relevant: ReadonlyArray<string>,
): number {
  for (let i = 0; i < rankedIds.length; i++) {
    if (relevant.includes(rankedIds[i] as string)) return 1 / (i + 1);
  }
  return 0;
}

export function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile (matches the bench harness's definition). */
export function percentile(
  samples: ReadonlyArray<number>,
  fraction: number,
): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] as number;
}
