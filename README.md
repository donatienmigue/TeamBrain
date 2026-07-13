# TeamBrain

**One shared brain for your team's AI coding agents.**
Git-native memory that Claude Code, Cursor, and any MCP-capable agent read from
and write to — so your agents stop re-learning your codebase every session, per
developer, per tool.

[![CI](https://github.com/donatienmigue/TeamBrain/actions/workflows/ci.yml/badge.svg)](https://github.com/donatienmigue/TeamBrain/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40teambrain%2Fcli)](https://www.npmjs.com/package/@teambrain/cli)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![MCP compatible](https://img.shields.io/badge/MCP-compatible-6f42c1)](https://modelcontextprotocol.io)

---

## The problem: the amnesia tax

AI coding agents are stateless and single-player. Every session starts cold.
Every developer's agent re-learns the same architecture, the same conventions,
the same "don't use that library." What one agent learns on Monday dies by
Tuesday — and never reaches a teammate at all.

This isn't just annoying, it's expensive: re-sent and re-explored context is
a large share of agentic token spend, and hand-maintained CLAUDE.md /
.cursorrules files rot, drift apart per tool, and capture nothing agents
learn while working.

The amnesia tax is the time spent pasting context, watching agents fail in known
ways, and hand-writing `.cursorrules` or `CLAUDE.md` files that quickly go stale.

## What TeamBrain does

- **One brain, every tool.** A `.teambrain/` directory of plain-markdown
  memories (decisions, conventions, codebase map, learnings), served to any
  MCP-capable agent. New teammate? New tool? Full team context on day one.
- **It learns — with your approval.** A CI job distills what agents actually
  struggled with this week into proposed memories, opened as a pull request.
  You review memories like you review code. Nothing enters the brain silently.
- **Your git host is the backend.** No TeamBrain servers. Sync is `git push`.
  Distillation runs in your CI with your LLM key. `git clone` is a full export.

## Quick start (5 minutes)

```sh
npm i -g @teambrain/cli
cd your-repo
tb init                    # imports CLAUDE.md/.cursorrules/AGENTS.md/ADRs → PR-ready branch
tb install claude-code     # registers MCP server + hooks (shows the diff first)
tb serve                   # start the local daemon
```

Your next Claude Code session starts with the team's memories injected as
context (silently — run `tb doctor` to confirm the daemon is serving). That's it.
Add the distiller to CI with the templates in [`ci-templates/`](ci-templates/) to
close the loop.

## How it works

```
session runs → hooks capture (redacted, metadata-only)
  → CI distiller proposes memories → PR → human approves
  → every agent, every tool, next session
```

Retrieval is local: SQLite + FTS5 + local embeddings (no API calls to read
memory, works offline). LLM calls happen only in the distiller, in your CI,
with your key.

## What TeamBrain records — and what it never records

By default (`capture.level: metadata`): files touched, command exit codes,
retries, outcomes. **Never raw prompts, file contents, or diff bodies.**
Redaction (secrets, PII, entropy scan) runs on-device before anything is
written; the redaction test corpus is public and gates CI.
Run `tb audit` to see exactly what a session recorded. No individual metrics,
no leaderboards, no phone-home — the digest is aggregate-only by construction.
See [SECURITY.md](SECURITY.md) for the full threat model and [FORMAT.md](FORMAT.md)
for the memory file spec.

## Why not just…

- **CLAUDE.md / Team Rules / Copilot Spaces?** Static, per-vendor, hand-
  maintained. TeamBrain syncs those *and* adds the part they can't: learning
  from real sessions, across tools, with review.
- **A memory SaaS?** Your team's knowledge in someone else's cloud graph, no
  approval loop. TeamBrain is markdown in your repo. Leave anytime; it's git.

## Agent Capture Support

TeamBrain provides cross-vendor support with a graceful degradation model. Capture hooks intercept agent activity and distill it into proposed memories without compromising privacy.

<!-- capture-matrix:start -->
| Capability | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| Install command | `tb install claude-code` | `tb install codex` | `tb install cursor` |
| Capture tier | Native hooks | MCP-side inference | MCP-side inference |
| Session start | Yes (native hook) | Yes (MCP-side inference) | Yes (MCP-side inference) |
| Session end | Yes (native hook) | Yes (MCP-side inference) | Yes (MCP-side inference) |
| Tool use (edits / commands / tests / exploration) | Yes (native hook) | No | No |
| Commit SHAs & outcome | Yes (native hook) | No | No |
| Plan revisions | No | No | No |
| Memory search / retrieve (MCP tool) | Yes | Yes | Yes |
| Propose memory (MCP tool) | Yes | Yes | Yes |
<!-- capture-matrix:end -->

*Note: Cursor lacks native lifecycle and post-tool hooks. Edit and command telemetry are unavailable, so Cursor sessions will lack `tool_use` events. Session boundaries are inferred from MCP tool calls: a session ends when it proposes a memory or after 30 minutes of inactivity. Commit SHAs and outcome are not captured for Cursor sessions.*

## CodeMap (v1.1, opt-in)

CodeMap is a machine-generated map of your codebase — per-file structural
summaries, built incrementally in CI and served through the same
`memory_context`/`memory_search` tools (no new tools, no new commands to
learn). Agents start sessions oriented to the code instead of re-exploring
it from scratch.

- **Off by default.** Enable with `codemap.enabled: true` in
  `.teambrain/brain.yaml` plus the [`ci-templates/codemap.yml`](ci-templates/codemap.yml)
  workflow; the map builds on the next merge and updates incrementally
  (only changed files are re-summarized, via `tb distill --codemap`).
- **Derived, not governed.** Entries live in `.teambrain/codemap/` as
  readable, diffable markdown — regenerable from source at any commit, so
  they are indexed directly rather than PR-gated like memories.
- **Budget-isolated.** The CodeMap slice rides in its own 1,500-token
  context budget; it can never crowd a governed memory out of
  `memory_context` (enforced by a gated negative test).

Honest status: shipped and tested, but the value target (≥30% fewer
code-exploration actions per session) is still being measured in dogfooding —
which is why the default stays off.

## Status & limits

v1. Claude Code fully supported; Cursor supported with degraded capture (no
edit/command telemetry — see the matrix above); Codex/Kiro adapters next.
macOS/Linux, Windows via WSL.
Honest limits: distiller quality depends on your session volume (it needs ~5+
sessions/week to propose anything useful), and multi-repo org brains aren't
built yet. Milestone-by-milestone plan in `docs/internal/BUILD_PLAN.md`.

## Documentation

| For | Read |
|---|---|
| Using TeamBrain in your repo | This README + `tb --help` (grouped commands, exit codes, examples) |
| The memory file format | [FORMAT.md](FORMAT.md) |
| Threat model & privacy guarantees | [SECURITY.md](SECURITY.md) |
| **Contributing / developing TeamBrain itself** | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — setup, repo map, architecture, test recipes — then [CONTRIBUTING.md](CONTRIBUTING.md) |
| CI wiring for the distiller/digest/lint | [ci-templates/](ci-templates/) |

Apache-2.0. Contributions welcome — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
gets you from clone to first PR; the public redaction corpus is a great entry
point (adversarial cases especially appreciated).
