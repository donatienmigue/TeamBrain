---
id: 01JZCP0A1B2C3D4E5F6G7H8J9K
class: decision
scope: team
status: active
priority: required
title: "Adopt sqlite-vec for local vector search"
created: 2026-07-01
evidence:
  sessions:
    - cmpt-001
  commits:
    - 4a15c9c
supersedes:
  - 01JZCNZZ9Y8X7W6V5T4S3R2Q1P
tags:
  - retrieval
  - architecture
ttl_days: null
---

Use sqlite-vec for the vector half of hybrid retrieval. It persists
vectors inside the same rebuildable index.db as the FTS5 mirror, so
index corruption never loses data (git stays the source of truth).
