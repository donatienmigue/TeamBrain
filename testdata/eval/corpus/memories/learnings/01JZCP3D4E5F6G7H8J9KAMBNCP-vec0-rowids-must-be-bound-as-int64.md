---
id: 01JZCP3D4E5F6G7H8J9KAMBNCP
class: learning
scope: team
status: active
priority: advisory
title: "vec0 rowids must be bound as int64"
created: 2026-07-04
supersedes: []
tags:
  - sqlite
  - gotcha
ttl_days: 90
---

sqlite-vec vec0 virtual tables reject plain JS-number rowid
bindings; convert to BigInt before insert or delete.
