---
id: 01J9MD4E5F6G7H8J9K0M1N2P3Q
class: learning
scope: team
status: active
priority: advisory
title: "FTS5 uses porter stemming for lexical recall"
created: 2026-06-23
supersedes: []
tags:
  - search
  - fts
ttl_days: null
---

The FTS5 mirror is configured with the porter tokenizer so that queries for
"caching" match documents that say "cache" or "cached". Keep this in mind
when writing golden queries: exact-form matching is not required for the
lexical arm of the hybrid search.
