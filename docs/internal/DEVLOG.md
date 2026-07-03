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

## M1.1 — core: schemas, IDs, front-matter round-trip
What: zod schemas for C1 front-matter, C2 events, brain.yaml; in-house ULID
(node:crypto); slugify; canonical parse/serialize with byte-exact round-trip
over the 13-fixture corpus. Ambiguities resolved: evidence optional in schema
(distiller-mandatory check → M1.2 lint, C1 has no proposer field); byte-exact
guarantee applies to canonical form; brain.yaml/event data shapes kept minimal
+ additive-loose. Also fixed latent M0.1 bug: per-package vitest configs so
`pnpm --filter <pkg> test` works (root config's projects glob broke inside
packages). Deps: zod, yaml (justified in commit body); ULID hand-rolled.

## M1.2 — tb lint + injection heuristics
What: injection-patterns table + scanner (scans whitespace-normalized text
so phrases split by hard-wrapping still match); core lint rules (schema,
400-word body, evidence, injection, class/status placement); first real
`tb` binary (commander) with C6 exit codes. Ambiguity: C1 has no proposer
field, so default lint only rejects empty evidence blocks; the distill PR
check opts into mandatory evidence via `--require-evidence`.
