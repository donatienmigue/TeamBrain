# Devlog

## M0.1 — Monorepo skeleton
What: pnpm workspace with 7 packages (core/index/mcp/hooks/redact/distill/cli),
shared strict/ESM/NodeNext tsconfig via `tsc -b` project references, vitest
workspace projects, eslint+prettier, GitHub Actions CI on Node 20/22.
Why: establishes the build/test/lint/bench loop every later milestone needs.
Tradeoffs: packages hold only placeholder exports; `cli` imports `core`'s
placeholder solely to prove workspace linking + build ordering work.

## Repo hygiene — OSS-ready structure
What: moved internal build-process docs (CONTRACTS, BUILD_PLAN,
KICKOFF_PROMPTS, DEVLOG, TECH_BRIEF) into docs/internal/; rewrote README.md
as an honest early-stage OSS README (no install/usage instructions since
nothing is runnable yet); added CONTRIBUTING.md pointing contributors —
human or AI — at the internal docs.
Why: repo is meant to be a public GitHub repo; top-level docs should read
like a product repo, not a starter-kit's build-instructions-to-an-AI-agent.
Tradeoffs: none of the frozen contracts, milestone plan, or CLAUDE.md
guardrails were removed — only relocated — so future milestone sessions are
unaffected; CLAUDE.md stays at root since Claude Code auto-loads it there.
