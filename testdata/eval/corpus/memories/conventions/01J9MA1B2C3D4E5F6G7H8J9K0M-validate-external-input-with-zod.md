---
id: 01J9MA1B2C3D4E5F6G7H8J9K0M
class: convention
scope: team
status: active
priority: required
title: "Validate external input with zod at every boundary"
created: 2026-06-20
supersedes: []
tags:
  - validation
  - zod
ttl_days: null
---

Every value that crosses a package boundary from the outside world — CLI
arguments, file contents, socket payloads, MCP tool inputs — is parsed with
a zod schema before any other code touches it. Never trust an `any`. This is
a required rule: reviewers block merges that skip validation on external
input.
