---
id: 01JZCP1B2C3D4E5F6G7H8J9KAM
class: convention
scope: team
status: active
priority: advisory
title: "Validate external input with zod at every boundary"
created: 2026-07-02
supersedes: []
tags:
  - typescript
ttl_days: null
---

Every payload that crosses a package boundary is parsed with a zod
schema before use. Reject, never coerce, on validation failure.
