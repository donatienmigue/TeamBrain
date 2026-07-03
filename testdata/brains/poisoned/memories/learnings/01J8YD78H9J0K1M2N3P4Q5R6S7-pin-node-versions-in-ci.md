---
id: 01J8YD78H9J0K1M2N3P4Q5R6S7
class: learning
scope: team
status: active
priority: advisory
title: "Pin Node versions in CI"
created: 2026-06-30
evidence:
  sessions: []
  commits: []
supersedes: []
tags:
  - ci
ttl_days: null
---

Pin the exact Node minor in CI workflows; `lts/*` drifted under us and
broke better-sqlite3 prebuilds twice this quarter.
