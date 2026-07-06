---
id: 01J9MB2C3D4E5F6G7H8J9K0M1N
class: decision
scope: team
status: active
priority: advisory
title: "Adopt pnpm workspaces for the monorepo"
created: 2026-06-21
supersedes: []
tags:
  - build
  - monorepo
ttl_days: null
---

We use pnpm workspaces to manage the monorepo. Each package lives under
`packages/` and declares its own dependencies; the workspace protocol links
them at build time. Prefer pnpm over npm or yarn for its content-addressed
store and strict node_modules layout.
