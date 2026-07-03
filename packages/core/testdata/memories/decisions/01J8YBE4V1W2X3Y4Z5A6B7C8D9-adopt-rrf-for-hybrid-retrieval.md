---
id: 01J8YBE4V1W2X3Y4Z5A6B7C8D9
class: decision
scope: team
status: active
priority: advisory
title: "Adopt RRF for hybrid retrieval"
created: 2026-06-30
supersedes: []
tags:
  - retrieval
ttl_days: null
---

Fuse lexical and vector search results with reciprocal-rank fusion rather
than score normalization. Take the top forty results from BM25 and the top
forty from the vector index, then rank the union by the sum of reciprocal
ranks with the standard damping constant of sixty. Do not attempt to
normalize raw scores across the two systems: BM25 scores are unbounded and
corpus-dependent, cosine similarities live in a narrow band near one, and
any linear combination of the two ends up tuned to a specific corpus
snapshot. Rank positions are stable across corpora, which is the entire
appeal of the fusion approach.

Apply filters after fusion, not before. Filtering before fusion changes the
rank positions each system reports and quietly biases the fused ordering
toward whichever system had more surviving candidates. The filter pass
removes retired memories, memories outside the requesting scope, and
memories whose TTL has lapsed. Memories tagged as required by the brain
configuration bypass ranking entirely and are force-included ahead of the
fused list.

Trim the final list to the token budget by dropping whole memories from the
tail, never by truncating a memory body mid-sentence. A truncated
convention reads as a complete instruction and will be followed as written,
which is worse than omitting it. When the budget is exhausted, prefer
keeping one complete memory over two fragments, and record the number of
dropped candidates so the daemon can report retrieval pressure in its
diagnostics.
