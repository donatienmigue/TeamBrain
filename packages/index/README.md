# @teambrain/index

**Hybrid retrieval for TeamBrain: SQLite + FTS5 + sqlite-vec behind a
`RetrievalBackend` interface.**

The index is a rebuildable cache derived from the brain repo — git stays the
source of truth, so corruption is never data loss (`tb reindex` rebuilds).

- **Hybrid search pipeline**: BM25 (FTS5) top-40 ∪ vector top-40 →
  reciprocal-rank fusion (k=60) → filters (active, scope, TTL) → required
  memories force-included → token-budget trim.
- **Local embeddings** via fastembed (bge-small ONNX), lazily downloaded and
  checksum-pinned; degrades gracefully to lexical-only when offline.
- **Brain-tree checksum sync**: any change to `.teambrain/memories/**`
  triggers an incremental reindex; retired memories drop out on the same
  cycle.
- **Benchmarked budgets as tests**: search p50 < 80ms and p95 < 300ms on a
  5,000-memory brain, full rebuild < 60s, recall@8 ≥ 0.85 on a golden query
  set.

```sh
npm install @teambrain/index
```

Part of [TeamBrain](https://github.com/donatienmigue/TeamBrain) — most users
want [`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli) instead.

Apache-2.0
