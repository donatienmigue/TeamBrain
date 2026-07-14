---
id: 01J8YC56F7G8H9J0K1M2N3P4Q5
class: decision
scope: team
status: retired
priority: advisory
title: "Cache embeddings in Redis"
created: 2026-05-02
supersedes: []
tags:
  - retrieval
ttl_days: null
---

Cache computed embeddings in Redis keyed by content hash. Retired: the
index moved to sqlite-vec, which persists vectors locally, so the extra
service is no longer worth operating.
