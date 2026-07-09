# TeamBrain

**One shared brain for your team's AI coding agents.**
Git-native memory that Claude Code, Cursor, and Codex read from and write to —
so your agents stop re-learning your codebase every session, per developer, per tool.

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
the dominant share of agentic token spend, and hand-maintained CLAUDE.md /
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
tb init                    # imports CLAUDE.md/.cursorrules/AGENTS.md/ADRs → opens a PR
tb install claude-code     # registers MCP server + hooks (shows the diff first)
tb serve                   # start the local daemon
```

Next Claude Code session prints: `Loaded 47 team memories.` That's it.
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
written; the redaction test corpus is public and release-gating.
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

| Feature / Tool | Claude Code | Cursor |
|----------------|-------------|--------|
| **Install Command** | `tb install claude-code` | `tb install cursor` |
| **Session Start** | Yes (Native Hook) | Yes (MCP-side inference) |
| **Session End** | Yes (Native Hook) | Yes (MCP-side inference) |
| **File Edits / Bash Commands** | Yes (Native Hook) | **No** (Degraded mode) |
| **Memory Search/Retrieve** | Yes (MCP Tool) | Yes (MCP Tool) |
| **Propose Memory** | Yes (MCP Tool) | Yes (MCP Tool) |

*Note: Cursor lacks native lifecycle and post-tool hooks. Edit and command telemetry are unavailable, so Cursor sessions will lack `tool_use` events. Sessions and their resulting commits are still captured via the MCP-side inference wrapper.*

## For Contributors

v1. Claude Code fully supported; Cursor capture in progress (context serving
already works via MCP); Codex/Kiro adapters next. macOS/Linux, Windows via WSL.
Honest limits: distiller quality depends on your session volume (it needs ~5+
sessions/week to propose anything useful), and multi-repo org brains aren't
built yet. Milestone-by-milestone plan in `docs/internal/BUILD_PLAN.md`.

Apache-2.0. Contributions welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md)
and the public redaction corpus (adversarial cases especially appreciated).
