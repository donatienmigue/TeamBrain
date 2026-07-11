# ADR: CodeMap backend — build generation, keep current retrieval

**Status:** Accepted (ratifies the decision the D6 implementation already
embodies; recorded per the CodeMap Technical Brief §3)
**Date:** 2026-07-11

## Context

CodeMap (R16) has two separable steps: **generation** (source files →
structural summaries) and **retrieval** (summaries → ranked results).
Incremental repo summarization is exactly what external engines such as
Cognee and Mem0 already do, making CodeMap the strongest buy-vs-build
candidate in the product. The C4 `RetrievalBackend` interface was designed so
an external engine can sit behind it without touching callers.

## Decision

1. **Build generation.** A small, focused summarizer in `packages/distill`
   (`updateCodemap`) using the existing C5 `Provider` interface — one
   structured-output call per changed file, hash-manifest incremental diff.
   This keeps the offline/own-key posture (the team's LLM key, in the team's
   CI), keeps `packages/distill` the sole LLM boundary, and preserves
   single-binary distribution. Embedding Cognee/Mem0 for generation would
   drag in a Python runtime or a service.
2. **Keep the current SQLite hybrid for retrieval.** FTS5 + sqlite-vec + RRF
   behind `RetrievalBackend`, with CodeMap docs indexed under the reserved
   `source: 'codemap'`. Commodity parity, not victory: no graph DB, no
   bespoke retrieval sophistication.
3. **Hold the backend-swap option open.** If pilot data shows the hybrid
   under-serves structural queries, a Cognee/Mem0-backed `RetrievalBackend`
   can replace the store without touching MCP callers.

## Swap trigger (OQ-CM4, defined so the decision is data-driven)

Revisit retrieval only if, on real dogfood/pilot sampling, **structural
queries** ("where does X live", "what calls Y") fail to surface the target
file's CodeMap entry in the top 5 results for **more than 30% of sampled
queries over a full working week**, measured from `memory_search` retrieval
logs against human-labeled expected files. Below that threshold the hybrid is
serving; above it, prototype one external backend behind `RetrievalBackend`
and compare recall on the same sample before adopting.

## Consequences

- Generation cost scales with changed files only (bench-gated: 20-file
  incremental on a 500k-LOC fixture well under the 2-minute budget).
- No new dependency, no new egress channel; the egress-guard test is
  unchanged.
- If the swap is ever exercised, only `packages/index` internals change;
  generation and all agent-facing surface stay ours.
