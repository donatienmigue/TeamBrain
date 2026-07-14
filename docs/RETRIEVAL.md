# Retrieval quality — measured, not assumed (R10)

TeamBrain's retrieval was evaluated with the **production embedder**
(fastembed BGE-small) on a **real corpus** — not the synthetic CI bench.
This document is the honest record: the numbers, the ablation, what carries
the score, and what doesn't. Reproduce with `pnpm eval`.

**Date:** 2026-07-14 · **Harness:** `packages/index/src/eval/` ·
**Corpus:** `testdata/eval/corpus/` · **Queries:** `testdata/eval/queries.yaml`

## The result

```
corpus: eval-corpus (dogfood + fixture brains) (20 memories)   embedder: fastembed-fast-bge-small-en-v1.5
queries: 40 positive + 8 negative

                              recall@1  recall@3  recall@5  recall@8   MRR
  lexical only (BM25)           0.55      0.70      0.82      0.93     0.67
  vector only                   0.50      0.85      0.93      0.95     0.69
→ hybrid RRF (shipped)          0.63      0.93      0.95      0.97     0.76
  hybrid weighted 0.7/0.3       0.57      0.90      0.93      0.93     0.72

memory_context hit-rate (2000-token bundle): 1.00
latency (shipped mode): p50 185.3ms   p95 247.9ms
```

## Verdict (per the pre-registered §4 decision table)

**Hybrid recall@5 = 0.95 ≥ 0.90 → no retrieval problem. The question is
closed; no retrieval sophistication gets added.** Effort goes back to
governance and capture.

## What the ablation says

- **Fusion genuinely earns its keep.** Hybrid beats both single channels at
  every k (recall@3: 0.93 vs 0.70 lexical / 0.85 vector). Neither channel
  alone reaches the floor.
- **The vector channel carries the paraphrase cases.** On deliberately
  vocabulary-shifted queries, vector-only (0.93@5) beats BM25-only (0.82@5) —
  the opposite of PMB's published ablation, where BM25 carried the score.
  Their result did not transfer; measuring our own was the point.
- **Weighted fusion (0.7 lexical / 0.3 vector) is a regression** (0.93@5 vs
  0.95@5, MRR 0.72 vs 0.76). The "cheapest likely win" from the brief loses
  to plain weightless RRF here. Not adopted.

## The two honest findings (the parts that make us look bad)

1. **Precision on negatives is a real gap.** All 8 "nothing relevant"
   queries (JWT, CSS, kubernetes, …) returned results — the shipped path has
   **no abstention mechanism**, so `memory_search` always surfaces its top-k
   even when the honest answer is "nothing". Worse, RRF scores are
   rank-shaped, not similarity-calibrated, so no threshold on the fused
   score can separate a junk top-1 from a real hit (on a small corpus every
   doc appears in both channel lists and crosses any workable τ). Fixing
   this needs a raw-similarity floor (e.g. cosine from the vector arm), not
   an RRF threshold. Per the brief: junk in every agent's context is a
   trust bug — this is the one follow-up worth considering, and it is a
   *precision* fix, not retrieval sophistication.
2. **The real-embedder latency budget assumption was wrong.** `pnpm bench`
   budgets p50 < 80ms measured with the offline HashingEmbedder; with the
   production ONNX model, query embedding dominates and p50 is **185ms**
   (p95 248ms — still inside the 300ms p95 budget). Session-start context
   assembly is unaffected (`memory_context` runs no query embedding), but
   per-query search latency in production is ~2.3× the synthetic number.

## memory_context hit-rate: 1.00, and why that is *not* a win

The C3 bundle is query-less — required-first, newest-first, trimmed to
2000 tokens, **no ranking at all**. At 20 memories, most of the brain fits
in the bundle, so a perfect hit-rate is arithmetic, not intelligence. This
metric only becomes informative once a brain outgrows its token budget;
re-run it when the dogfood brain is 5–10× larger before drawing any
conclusion about session-start relevance scoping.

## Caveats (read before quoting the numbers)

- **Corpus size:** 20 memories — below the brief's 50–150 minimum viable.
  The dogfood brain currently holds 8 (all imported CLAUDE.md rule-chunks);
  the rest are the repo's hand-written fixture memories. Numbers are
  directional until a real 50+ memory brain exists.
- **Query provenance:** `written_by: assistant` — paraphrased,
  agent-perspective, but authored by an AI assistant that had read the
  corpus, which is weaker than the brief's human-blind standard. Replacing
  these with questions pulled from real sessions is the standing E0
  follow-up; the harness re-runs unchanged.
- The eval is **not a CI gate** by design (§3.5): `pnpm bench` stays the
  fast offline smoke test; `pnpm eval` downloads the real model and is run
  on demand. `TEAMBRAIN_EVAL_OFFLINE=1` runs the plumbing with the hashing
  embedder (numbers meaningless for quality).

## Reproducing

```sh
pnpm eval          # downloads bge-small (~80MB, checksum-pinned) on first run
```

Ablation knobs live on `SearchOptions` (`channels`, `fusionWeights`) —
additive, eval-only; defaults are byte-identical to the shipped RRF path
(asserted by test).
