---
id: 01J8YBA0D1E2F3G4H5J6K7M8N9
class: learning
scope: team
status: active
priority: advisory
title: "Pin the fastembed model checksum"
created: 2026-06-28
supersedes: []
tags:
  - embeddings
ttl_days: 30
---

Verify the downloaded bge-small model against the pinned checksum before
first use; the upstream mirror has served truncated files twice. On
mismatch, delete the download and fall back to lexical-only retrieval with
a debug log rather than failing the daemon.
