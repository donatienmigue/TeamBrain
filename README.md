# TeamBrain V1 — Repo Starter

This starter contains everything Claude Code needs to build TeamBrain V1.

## Contents
- `CLAUDE.md` — project principles, stack, testing rules, definition of done (read by Claude Code automatically)
- `.claude/settings.json` — Stop-gate hook: Claude Code cannot end a turn with failing tests (parses hook JSON with Node — no `jq` dependency)
- `docs/CONTRACTS.md` — frozen v1 schemas and interfaces (authoritative)
- `docs/BUILD_PLAN.md` — milestones M0–M8 with acceptance commands + standing guardrails
- `docs/KICKOFF_PROMPTS.md` — the prompt to paste at the start of each milestone session
- `docs/DEVLOG.md` — one entry per completed task
- `packages/{core,index,mcp,hooks,redact,distill,cli}` — pnpm workspace packages (scaffolded in M0.1; real logic lands starting M1)

## Setup (5 minutes)
1. `git init teambrain && cd teambrain` — copy these files in, commit as `chore: repo starter`.
2. Optionally add the Technical Brief as `docs/TECH_BRIEF.md` (reference only; CONTRACTS.md wins on conflict).
3. Requirements on your machine: Node >= 20, pnpm, gh CLI authenticated. (`jq` is **not** required — the Stop-gate hook parses its input with Node instead.)
4. The Stop-gate references `pnpm test:changed` (`vitest run --changed`) — wired as part of M0.1.
5. Start a Claude Code session in the repo, enter plan mode, paste the M0 prompt from `docs/KICKOFF_PROMPTS.md`.

## Monorepo layout
```
packages/
  core/      brain format: schemas, IDs, parse/serialize (M1)
  index/     retrieval: sqlite + FTS5/vec0 hybrid search (M3)
  mcp/       MCP server exposing the 4 tools from CONTRACTS.md §C3 (M4)
  hooks/     Claude Code hook scripts: capture + redaction glue (M5)
  redact/    redaction engine + detector corpus (M5)
  distill/   CI distiller: cluster, draft, dedup, gate, PR (M6)
  cli/       `tb` command surface (CONTRACTS.md §C6)
```
Every package builds via TypeScript project references (`tsc -b`) and is
wired into the root `vitest`/`eslint` config. `cli` depends on `core` via
`workspace:*` as a standing smoke test that inter-package linking works.

## Commands
- `pnpm install` — install workspace dependencies
- `pnpm build` — `tsc -b` across all packages, respecting dependency order
- `pnpm test` — run every package's vitest suite
- `pnpm test:changed` — run only tests affected by uncommitted changes (what the Stop-gate hook runs)
- `pnpm lint` — eslint + `prettier --check`
- `pnpm bench` — runs each package's `bench` script if it defines one (no-op until M3.4)

CI (`.github/workflows/ci.yml`) runs all four of `build`/`test`/`lint`/`bench` on Node 20 and 22.

## Status
- **M0.1 done** — pnpm workspace skeleton, shared TS/vitest/eslint config, CI, `test:changed` wired. All of `pnpm build && pnpm test && pnpm lint && pnpm bench` pass locally.
- **Known gap**: `gh` CLI is not installed/authenticated on this machine. Not needed until later milestones (M2.3, M6.4, M7 use it for PR automation), but install and run `gh auth login` before then.
- **Next**: M1 (`packages/core` — brain format schemas), per `docs/BUILD_PLAN.md`.

## Operating rhythm
One milestone per fresh session -> review the diff yourself -> run the hostile-review prompt in a separate session -> tag `m<N>` -> next milestone. Before M5, run the Cursor hook-parity spike (OQ-1 in the Technical Brief); its outcome shapes the M5 adapter interface.
