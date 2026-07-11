# Developing TeamBrain

Everything you need to go from `git clone` to a merged PR. For *using*
TeamBrain in your own repo, see the [README](../README.md) instead.

## Setup (5 minutes)

Requirements: **Node ≥ 20**, **pnpm ≥ 9** (`corepack enable` is enough), git.
Optional: the `gh` CLI (authenticated) for the PR-opening paths (distiller,
init/retire flows against a real remote).

```sh
git clone https://github.com/donatienmigue/TeamBrain.git
cd TeamBrain
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm bench
```

All four must be green before and after your change — CI runs exactly these on
Node 20 and 22, plus actionlint over the workflows and a nightly full-loop
integration run.

> **Windows note.** Everything works natively (no WSL needed for development):
> the daemon uses a named pipe where POSIX uses a unix socket, and tests fake
> `~/.teambrain` via `TEAMBRAIN_HOME`. Avoid cloning under a OneDrive-synced
> folder if you can — file locking causes flaky deletes — and keep the
> checkout path short (deep paths break `git checkout` on fixture files).

## The 60-second architecture

```
agent (Claude Code / Cursor)
  │  MCP tools: memory_context · memory_search · memory_propose · memory_feedback
  ▼
tb daemon (packages/mcp) ──reads── SQLite index (packages/index)
  │                                   ▲  rebuilt from
  │  capture hooks (packages/hooks)   │
  ▼  redacted on-device (packages/redact)
local spool → git branch `teambrain/sessions` → CI distiller (packages/distill)
                                                    │
                                                    ▼
                              memory PR → human merges → .teambrain/ on main
```

Two invariants explain most of the design (full list in [CLAUDE.md](../CLAUDE.md)):

- **Git is the source of truth.** The SQLite index is a disposable cache
  (`tb reindex` rebuilds it); anything durable is a markdown file in the repo.
- **Nothing writes to the brain without a human merge.** Agents and the
  distiller only *propose* — to a local spool or a PR branch.

## Repo map

| Package | What it owns | Start reading |
|---|---|---|
| `packages/core` | Memory/event schemas (zod), byte-exact parse/serialize, lint + injection patterns, ULIDs, logger, typed errors → exit codes | `src/memory.ts`, `src/events.ts` |
| `packages/index` | SQLite + FTS5 + sqlite-vec hybrid retrieval behind `RetrievalBackend`; brain-tree + codemap checksum sync; bench | `src/store.ts`, `src/search-pipeline.ts` |
| `packages/mcp` | MCP server (4 tools), daemon (`tb serve`), session spool → `teambrain/sessions` branch, injection-safe rendering | `src/tools.ts`, `src/daemon.ts`, `src/spool.ts` |
| `packages/hooks` | Agent payloads → C2 events; the privacy contract (paths + exit codes only, never content); Cursor adapter | `src/map.ts`, `src/redact-event.ts` |
| `packages/redact` | Secret/entropy/PII detectors, deny-globs, the public release-gating corpus | `src/engine.ts`, `corpus/` |
| `packages/distill` | Collect → cluster → LLM draft → dedup → gate → PR; the CodeMap generator (`tb distill --codemap`, opt-in); the only package allowed to call an LLM | `src/pipeline.ts`, `src/codemap/generate.ts` |
| `packages/cli` | Every `tb` command; thin wrappers over the packages above | `src/program.ts` |

Authoritative docs, in reading order:
[CLAUDE.md](../CLAUDE.md) (principles — they're tie-breakers, not suggestions) →
[docs/internal/CONTRACTS.md](internal/CONTRACTS.md) (**frozen** schemas; never
change without asking) → [docs/internal/BUILD_PLAN.md](internal/BUILD_PLAN.md)
(tasks + acceptance criteria) → [docs/internal/DEVLOG.md](internal/DEVLOG.md)
(what/why/tradeoffs of everything done so far).

## Running tests

```sh
pnpm test                                     # everything (~500 tests, <1 min)
pnpm --filter @teambrain/redact test          # one package
pnpm --filter @teambrain/cli test -- --run reindex   # tests matching a pattern
pnpm bench                                    # perf budgets (fails red, like tests)
```

Rules that will bite you if you skip them (full list in CLAUDE.md):

- **Tests never touch the network or your real home dir.** Point the runtime
  at a temp dir via `TEAMBRAIN_HOME` / injectable `runtimeDir` options; pass
  `embedder: null` to stay offline (lexical-only).
- **Negative tests are first-class.** Every new capability ships one — e.g.
  the corrupt-index test that caught a real file-handle leak, or the
  user-scope test that walks every pushed git object.
- **Performance budgets are tests.** `pnpm bench` fails if retrieval p50/p95,
  rebuild time, or recall regress. Don't tune budgets to pass; fix the code.
- **The compat gate is one-way.** `testdata/compat/v1-brain/` is a frozen
  byte-level snapshot; if `compat-v1.test.ts` fails, your change broke the
  on-disk format — never regenerate the fixture to make it pass.
- The **egress guard** (`packages/cli/src/egress-guard.test.ts`) fails any
  source file that adds network syntax outside the three allowlisted modules.

## Dogfooding: this repo runs TeamBrain on itself

The repo has its own brain (`.teambrain/`), MCP registration (`.mcp.json`,
`.cursor/`), and capture hooks (`.claude/settings.json`). To experience what
you're building:

```sh
pnpm build
node packages/cli/dist/tb.js serve      # or `tb serve` if linked globally
# in another terminal:
node packages/cli/dist/tb.js doctor    # daemon, index, capture health
node packages/cli/dist/tb.js audit --last-session
```

A Claude Code session in this repo will then load the team memories at start
and its activity is captured (metadata-only, redacted). `tb audit` shows you
exactly what was recorded — use it whenever you touch the capture path.

A `Stop` hook runs `pnpm test:changed` at the end of every Claude Code turn,
so an agent-assisted turn can't end with failing tests.

## Common tasks

**Add a `tb` subcommand** — implement `run<X>Command()` in
`packages/cli/src/<x>-command.ts` returning `{ exitCode, output }` (exit
codes: 0 ok · 1 user error · 2 environment · 3 validation — throw the typed
errors from `@teambrain/core` and map with `exitCodeForError`). Register it in
`program.ts` with a `helpGroup`, add help copy to `help-text.ts`, write tests
including at least one negative. Note `tb propose`/`tb reindex` as templates.

**Add a redaction detector** — add the rule in `packages/redact/src/` *and*
corpus cases in `packages/redact/corpus/` (true positives **and** tricky
negatives — UUIDs and git SHAs must not redact). The corpus is release-gating.

**Add an injection-lint pattern** — extend the table in
`packages/core/src/injection-patterns.ts`; every entry needs one positive and
one negative case in its test file.

**Touch retrieval** — the pure stages live in
`packages/index/src/search-pipeline.ts` (unit-testable, no DB); the SQL halves
in `store.ts`. Contract order is frozen (C4): BM25 ∪ vector → RRF → filters →
required force-include → token trim. Run `pnpm bench` after.

**Change a schema** — stop. Schemas in `CONTRACTS.md` are frozen; write a
proposal in the DEVLOG and ask first.

## Pull requests

- One task per commit; reference the BUILD_PLAN/IMPROVE_PLAN task or AUDIT
  finding ID it implements.
- Append a short DEVLOG entry (what/why/tradeoffs, ≤5 lines) per task.
- New dependency? One-line justification in the commit body — stdlib > small
  vetted lib > framework; ORMs/DI/langchain-style wrappers need discussion.
- `pnpm build && pnpm test && pnpm lint && pnpm bench` green locally.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `tb doctor` says daemon unreachable | Start `tb serve` in the repo that holds the brain; hooks degrade silently by design when it's down. |
| Index looks stale or corrupt | `tb reindex` — always safe, git is the truth. |
| better-sqlite3 ABI errors after a Node upgrade | `pnpm rebuild better-sqlite3` |
| Bench fails only on your machine | Budgets assume unloaded hardware; close the IDE indexer, rerun. If it still fails, treat it as real. |
| A fixture test fails with CRLF noise on Windows | Fixture corpora are LF-forced via `.gitattributes`; if you added fixtures, cover them there too. |
| Tests wrote to your real `~/.teambrain` | Bug — they must use `TEAMBRAIN_HOME`/injected dirs. Report it. |
