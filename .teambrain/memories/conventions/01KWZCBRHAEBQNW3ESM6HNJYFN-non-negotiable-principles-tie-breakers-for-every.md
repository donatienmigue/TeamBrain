---
id: 01KWZCBRHAEBQNW3ESM6HNJYFN
class: convention
scope: team
status: active
priority: advisory
title: "Non-negotiable principles (tie-breakers for every decision)"
created: 2026-07-07
supersedes: []
tags:
  - imported
  - "source:CLAUDE.md"
ttl_days: null
---

## Non-negotiable principles (tie-breakers for every decision)
1. Git is the source of truth. SQLite index is a rebuildable cache — index
   corruption must never lose data. Anything durable is a file in the repo.
2. Graceful degradation. Hooks fire-and-forget; if the daemon is down, events
   drop silently and the agent session is unaffected. No hook path may block,
   throw to the caller, or exceed 20ms p95.
3. Privacy by construction. Default capture level is `metadata`: never record
   raw prompts, file contents, or diff bodies. Redaction runs before anything
   touches the spool. Never log memory bodies or event payloads at info level.
4. Human-approved writes only. No code path writes to memories/ on main;
   automation writes to branches and opens PRs.
5. Vendor-neutral. All agent-facing behavior goes through MCP + thin per-tool
   hooks. No richer code path for one vendor.
6. Boring dependencies. Adding a dependency requires a one-line justification
   in the commit body. Prefer: node stdlib > small vetted lib > large framework.
   Banned without discussion: ORMs, DI frameworks, langchain-style wrappers.
