---
id: 01J8YB01A2B3C4D5E6F7G8H9J0
class: convention
scope: team
status: active
priority: required
title: "Wrap errors with cause chains"
created: 2026-06-05
supersedes: []
tags:
  - errors
  - typescript
ttl_days: null
---

When re-throwing, always construct a new typed error and pass the original
via the cause option. Never swallow the original error and never re-throw a
bare string. Catch blocks that intentionally degrade must log the reason at
debug level before returning.
