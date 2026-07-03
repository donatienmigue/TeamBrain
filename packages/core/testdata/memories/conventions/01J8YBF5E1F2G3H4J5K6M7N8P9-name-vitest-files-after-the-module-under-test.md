---
id: 01J8YBF5E1F2G3H4J5K6M7N8P9
class: convention
scope: team
status: active
priority: advisory
title: "Name vitest files after the module under test"
created: 2026-07-01
supersedes: []
tags: []
ttl_days: null
---

Place tests next to the source as module.test.ts, one test file per module.
Do not create umbrella test files that exercise several modules at once;
they hide which unit regressed when the suite fails.
