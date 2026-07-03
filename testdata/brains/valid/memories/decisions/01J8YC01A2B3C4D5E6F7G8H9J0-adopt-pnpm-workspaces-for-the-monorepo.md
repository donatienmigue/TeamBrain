---
id: 01J8YC01A2B3C4D5E6F7G8H9J0
class: decision
scope: team
status: active
priority: advisory
title: "Adopt pnpm workspaces for the monorepo"
created: 2026-06-20
supersedes: []
tags:
  - tooling
ttl_days: null
---

Use pnpm workspaces for all packages. Run everything through the root
`pnpm build|test|lint` pipeline so local runs and CI stay identical.
Do not add per-package lockfiles; the root lockfile is the only one.
