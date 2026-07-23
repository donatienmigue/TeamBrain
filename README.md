# TeamBrain

**One shared brain for your team's AI coding agents.**

Git-native memory that Claude Code, Cursor, and any MCP-capable agent read from — and that your team writes to the same way it writes code: as a pull request someone approves.

[![CI](https://github.com/donatienmigue/TeamBrain/actions/workflows/ci.yml/badge.svg)](https://github.com/donatienmigue/TeamBrain/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@teambrain/cli)](https://www.npmjs.com/package/@teambrain/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-black)](https://modelcontextprotocol.io)

---

## The problem

Your team's AI agents start every session knowing nothing. The migration gotcha someone hit on Tuesday is re-discovered on Thursday by a different developer in a different tool. Every session re-reads the same files, re-asks the same questions, and re-derives the same conclusions.

Teams patch this with `CLAUDE.md` and `.cursorrules` — hand-maintained files that drift, live in one tool, and only contain what someone remembered to write down. Nobody updates them after the session where they learned the thing.

TeamBrain keeps that knowledge in your repo, serves it to every agent, and proposes new entries from what your sessions actually did — with a human approving each one.

## The 30-second mental model

```
memories are markdown files in your repo          ← you can read, diff, and revert them
       │
       ├─► a local daemon indexes them            ← retrieval is on your machine, offline
       │        └─► serves them over MCP          ← any agent, no vendor lock-in
       │
       └─► a CI job watches how sessions go       ← metadata only, redacted on-device
                └─► opens a pull request          ← nothing is written without a human
```

Four things follow from that, and they're the whole product:

1. **Your memory is a directory of markdown you own.** `git clone` is a complete export. There is no TeamBrain server, database, or account.
2. **Retrieval is local and offline.** SQLite + FTS5 + local ONNX embeddings. Reading memory never calls an API.
3. **Writes go through review.** No code path commits to `memories/` on your default branch. Every addition is a PR.
4. **It's tool-neutral by construction.** Serving is plain MCP, so an agent that speaks MCP can read your brain today.

## Quick start (about 5 minutes)

```bash
npm i -g @teambrain/cli

cd your-repo
tb init                    # imports CLAUDE.md / .cursorrules / AGENTS.md / ADRs → PR-ready branch
                           # review the branch, open a PR, merge it
tb install claude-code     # registers the MCP server + hooks (shows a diff, asks first)
tb serve                   # start the local daemon
tb doctor                  # confirm it's all wired
```

**What you'll see next: nothing.** Your next Claude Code session starts with the team's memories already in context — injected silently, with no banner and no output. This is deliberate (a hook that prints breaks some clients), but it means the only way to know it's working is to check:

```bash
tb doctor                  # daemon running, socket reachable, index docs: N
tb audit --last-session    # exactly what the last session recorded, as stored
```

If `tb doctor` is green and `index docs` is greater than zero, your agents are being served.

## What a memory actually looks like

A memory is one markdown file with YAML front-matter. That's the entire format.

```markdown
---
id: 01J8XQ2F7K3N5P9R1T4V6W8Y0Z
class: convention
scope: team
status: active
priority: required
title: Payment retries belong in the gateway wrapper, not the caller
created: 2026-06-14
evidence:
  sessions: [01J8X9M2K4P6R8T0V2X4Z6B8D0]
  commits: [a3f9c21, 7b2e884]
tags: [payments, resilience]
ttl_days: null
---

Retry logic for payment provider calls lives in `src/payments/gateway-wrapper.ts`.
Do not add retries at call sites.

The wrapper owns idempotency-key generation. A retry issued from a call site
reuses the outer key and the provider treats it as a duplicate charge attempt —
this caused the double-authorization incident on 2026-05-31.

When adding a new provider, implement `PaymentProvider` and register it with the
wrapper. The wrapper handles backoff, jitter, and the circuit breaker.
```

`class` is one of `decision`, `convention`, `map`, `learning`. `priority: required` means it's force-included in every session's context; `advisory` means it competes on relevance. Bodies are capped at 400 words by the linter — a memory that needs more than that is two memories.

## How it works

**Serving.** `tb serve` runs a per-machine daemon that watches `.teambrain/`, keeps a derived SQLite index, and exposes an MCP server with four tools: `memory_context` (session-start bundle, ≤2000 tokens, required memories first), `memory_search`, `memory_propose`, `memory_feedback`. Retrieval is hybrid — BM25 via FTS5 unioned with vector search over local embeddings, fused by reciprocal rank, then filtered and trimmed to budget.

**Capturing.** Thin hooks emit metadata about what the session did: which files were touched, which commands exited non-zero, whether the session ended in a commit. Events are redacted on-device before they're written anywhere, then spooled locally and pushed to a dedicated `teambrain/sessions` branch that is never merged to main.

**Distilling.** A scheduled CI job in *your* repo, using *your* LLM key, reads new session records and merged diffs, clusters the signals (same file fought with across multiple sessions, repeated failing commands, searches that returned nothing), drafts candidate memories, checks them for duplicates and contradictions against the existing brain, and opens a pull request.

**Approving.** You review the PR like any other. Merge it and every developer's daemon picks it up on the next fetch. Retirement is the same loop in reverse: `tb retire <id> <reason>` opens a PR that moves the file to `retired/`.

Full component map, trust boundaries, and design decisions: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Using it well

Most of the value depends on habits, not configuration. The short version:

- **Fewer, sharper memories beat more memories.** Twenty precise entries outperform two hundred vague ones, because retrieval has to choose. A brain full of "we use TypeScript" makes the useful entries harder to surface.
- **Write the thing that was surprising**, not the thing that's obvious from reading the code. If an agent could figure it out in one file read, it doesn't need a memory.
- **`required` is a budget, not a label.** Every required memory is force-included in every session and permanently costs context. Most teams should have fewer than ten.
- **Retire aggressively.** A stale memory is worse than a missing one — it actively misleads every agent that reads it. Wrong memories are the main failure mode of every system in this category.
- **Review the distiller's PRs the same week.** The proposal queue only stays useful if it's short.

The full playbook — memory quality rules with examples, the 60-second PR review, why your memory isn't being retrieved, weekly rhythm, anti-patterns, and troubleshooting: **[docs/USAGE.md](docs/USAGE.md)**.

## What gets captured

Default is `capture.level: metadata`:

| Captured | Not captured |
|---|---|
| File paths touched | File contents, diffs, patches |
| Command kinds and exit codes | Command arguments |
| A ≤200-char local summary of intent | Your prompts, raw or otherwise |
| Session outcome, duration, commit SHAs | Anything the redactor flags as a secret or PII |

Redaction (secrets, PII, entropy scan) runs on your machine before anything is written to disk or pushed. The redaction corpus is public and lives in `packages/redact/`; it gates CI on every push.

The weekly digest is aggregate-only by construction — the aggregator can only see a projection of events that structurally drops session, tool, model, repo, and branch identifiers, and a test asserts no identity-bearing field survives even when it's fed authored fixtures. No individual metrics, no leaderboards.

There is no phone-home. Network calls happen in exactly four places, all of them yours: your git remote, your LLM provider (distiller only, in your CI), your Slack webhook if you configure one, and a one-time checksum-pinned download of the local embedding model. This is enforced by a test that scans all shipped source and fails the build on a new network call anywhere else.

Threat model and the full trust architecture: **[SECURITY.md](SECURITY.md)**.

## Verify it yourself

Don't take the section above on trust — the point of this architecture is that you don't have to:

```bash
tb audit --last-session     # the exact events stored for your last session, verbatim
tb doctor --json            # daemon, index freshness, retrieval latency, capture state
git log teambrain/sessions  # every session record that has ever left your machine
```

The redaction corpus, the egress scanner, and the privacy negative tests are all in the repo and run with `pnpm test`.

## Compatibility

Serving works with any MCP-capable agent. Capture depth depends on what lifecycle hooks the tool exposes. This matrix is generated from the adapter capabilities declared in code (`packages/hooks`), and a CI test fails the build if the table drifts from them — so it cannot overclaim:

<!-- capture-matrix:start -->
| Capability | Claude Code | Codex | Cursor | Gemini CLI |
| --- | --- | --- | --- | --- |
| Install command | `tb install claude-code` | `tb install codex` | `tb install cursor` | `tb install gemini-cli` |
| Capture tier | Native hooks | MCP-side inference | MCP-side inference | Native hooks |
| Session start | Yes (native hook) | Yes (MCP-side inference) | Yes (MCP-side inference) | Yes (native hook) |
| Session end | Yes (native hook) | Yes (MCP-side inference) | Yes (MCP-side inference) | Yes (native hook) |
| Tool use (edits / commands / tests / exploration) | Yes (native hook) | No | No | Yes (native hook) |
| Commit SHAs & outcome | Yes (native hook) | No | No | Yes (native hook) |
| Plan revisions | No | No | No | No |
| Memory search / retrieve (MCP tool) | Yes | Yes | Yes | Yes |
| Propose memory (MCP tool) | Yes | Yes | Yes | Yes |
<!-- capture-matrix:end -->

*Cursor and Codex lack usable native lifecycle/post-tool hooks, so their sessions carry no `tool_use` events. Session boundaries are inferred from MCP tool calls: a session ends when it proposes a memory or after 30 minutes of inactivity; commit SHAs and outcome are not captured. Any other MCP-capable agent can still read and propose memories (serving) — it just isn't captured.*

`tb install` automates setup for `claude-code`, `codex`, `cursor`, and `gemini-cli`. Other MCP clients work by pointing them at the server manually.

## Honest limits

- **It needs volume to learn.** The distiller proposes from patterns across sessions; roughly five or more agent sessions a week is where proposals start being useful. Below that, TeamBrain is a good governed store for memories you write yourself — which is still worth it, but it isn't the learning loop.
- **Cursor capture is genuinely partial**, not "coming soon." No lifecycle hooks means no edit telemetry and no commit attribution. The matrix above is the whole truth.
- **A brain is only as good as its retirement discipline.** Nothing in the system can tell that a correct memory became wrong when someone changed the code.
- **Single-repo today.** One brain per repo. Org-level and multi-repo scoping are not built.
- **macOS and Linux are the supported platforms.** Windows works (the full quick start has been run natively on Windows 11), but clone with `-c core.longpaths=true` and expect less coverage.

## Performance

Measured on a clean clone, 5,000-memory synthetic brain, ordinary CI hardware:

| | Result | Budget |
|---|---|---|
| Search latency | p50 39ms · p95 53ms | p50 <80ms · p95 <300ms |
| Index rebuild (5k memories) | 22.6s | <60s |
| Recall@8 on the golden query set | 1.00 | ≥0.85 |

Reproduce with `pnpm bench`.

## Documentation

| Document | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, data flow, trust boundaries, design decisions, extension points |
| [docs/USAGE.md](docs/USAGE.md) | Writing good memories, reviewing proposals, retrieval hygiene, weekly rhythm, troubleshooting |
| [FORMAT.md](FORMAT.md) | The memory file spec and session event schema |
| [SECURITY.md](SECURITY.md) | Threat model, redaction, egress, memory-poisoning stance |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to work on TeamBrain itself |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development setup |
| [ci-templates/](ci-templates/) | Ready-to-copy workflows: distill, digest, lint, session rotation, codemap |

## Status

V1 is complete and dogfooded. The governed loop — capture, distill, propose, approve, serve, retire — works end to end and is covered by an integration test that runs it on every build.

Not yet built: org and multi-repo scoping, GitLab distiller driver, a hosted tier, and verified Cline, Kiro, and Antigravity install adapters.

Apache-2.0. Issues and PRs welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
