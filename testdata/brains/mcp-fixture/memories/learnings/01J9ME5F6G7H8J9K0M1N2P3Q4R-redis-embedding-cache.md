---
id: 01J9ME5F6G7H8J9K0M1N2P3Q4R
class: learning
scope: team
status: active
priority: advisory
title: "Cache embeddings in Redis to skip recompute"
created: 2026-06-24
supersedes: []
tags:
  - embeddings
  - redis
ttl_days: null
---

Embedding the same memory twice is wasteful, so we cache computed vectors in
Redis keyed by content hash. This memory exists to be retired in the R5
negative test: after retirement it must vanish from memory_search within one
watcher cycle.
