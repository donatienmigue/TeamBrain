# Devlog

## M0.1 — Monorepo skeleton
What: pnpm workspace with 7 packages (core/index/mcp/hooks/redact/distill/cli),
shared strict/ESM/NodeNext tsconfig via `tsc -b` project references, vitest
workspace projects, eslint+prettier, GitHub Actions CI on Node 20/22.
Why: establishes the build/test/lint/bench loop every later milestone needs.
Tradeoffs: packages hold only placeholder exports; `cli` imports `core`'s
placeholder solely to prove workspace linking + build ordering work.
