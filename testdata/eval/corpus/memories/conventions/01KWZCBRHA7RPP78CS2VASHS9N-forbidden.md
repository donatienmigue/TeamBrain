---
id: 01KWZCBRHA7RPP78CS2VASHS9N
class: convention
scope: team
status: active
priority: advisory
title: "Forbidden"
created: 2026-07-07
supersedes: []
tags:
  - imported
  - "source:CLAUDE.md"
ttl_days: null
---

## Forbidden
- Editing docs/internal/CONTRACTS.md schemas (ask first).
- `any` types at package boundaries; skipping zod validation on external input.
- Writing to the user's real ~/.claude or ~/.cursor in tests (use TMPDIR fakes).
- console.log in library code (use the shared logger, packages/core/log).
- Silent catch blocks. Degradation must be logged at debug level with a reason.
