---
id: 01J8YD9AK1M2N3P4Q5R6S7T8V9
class: learning
scope: team
status: active
priority: advisory
title: "Vitest fake timers flake on CI"
created: 2026-06-30
supersedes: []
tags:
  - testing
ttl_days: null
---

Advance fake timers with `await vi.advanceTimersByTimeAsync` rather
than the sync variant; the sync form races the event loop on slow CI
runners.
