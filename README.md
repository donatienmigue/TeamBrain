# TeamBrain

Git-native, cross-vendor shared memory for AI coding agents.

> **Status: early-stage.** The brain format, `tb init` importer, retrieval
> index, MCP server, and daemon are implemented: memory schemas with
> byte-exact parse/serialize, `tb lint`, `tb init`, a SQLite hybrid
> (lexical + vector) index, and `tb serve` — a daemon that keeps the index
> fresh and serves the four memory tools to agents over MCP, plus
> `tb install claude-code` to wire the SessionStart hook and MCP server into
> a project. The capture hooks and CI distiller described below are designed
> but not yet implemented. See [Roadmap](#roadmap).

## What TeamBrain is

Coding agents (Claude Code, Cursor, etc.) relearn the same lessons every
session: a team's conventions, past decisions, and hard-won gotchas don't
carry over between sessions or across tools. TeamBrain is a shared memory
for those lessons that lives in your repo, not in a vendor's database:

- **The brain is a git repo.** Memories are markdown files with YAML
  front-matter, committed like any other file. Git history is the audit
  trail; pull requests are the approval gate — nothing is written to the
  shared brain without human review.
- **A local daemon serves it to your agent.** A per-machine daemon indexes
  the brain (SQLite with hybrid lexical + vector search) and exposes it to
  coding agents over MCP.
- **Capture is vendor-neutral and privacy-first.** Thin, fire-and-forget
  hooks record the *shape* of a session (files touched, commands run,
  outcomes) — never raw prompts or diffs — and redact secrets locally
  before anything is written to disk.
- **New memories are proposed, never auto-written.** A scheduled CI job
  reads recorded sessions and drafts candidate memories as a pull request.
  A human merges it.
- **Nothing leaves your machine un-redacted**, and no TeamBrain server is
  involved: sync happens through your own git remote, and distillation runs
  in your own CI using your own LLM API key.

## Repo layout

```
packages/
  core/      brain format: schemas, IDs, parse/serialize
  index/     retrieval: SQLite + FTS5/vector hybrid search
  mcp/       MCP server exposing memory_context/memory_search/memory_propose/memory_feedback
  hooks/     Claude Code (and later Cursor) capture hook scripts
  redact/    redaction engine + detector corpus
  distill/   CI distiller: cluster, draft, dedup, gate, open PR
  cli/       `tb` command surface
```

Every package builds via TypeScript project references (`tsc -b`) and shares
one root `vitest`/`eslint` config.

## Development

Requirements: Node >= 20, [pnpm](https://pnpm.io).

```
pnpm install
pnpm build              # tsc -b across all packages, respecting dependency order
pnpm test               # every package's test suite
pnpm test:integration   # tb init end-to-end against fixture git repos
pnpm lint               # eslint + prettier --check
pnpm bench              # retrieval performance budgets (p95, rebuild, recall)
```

CI runs all four on Node 20 and 22 (`.github/workflows/ci.yml`).

## Roadmap

Currently heading into **M5 — capture hooks + redaction**. Done so far:

- **M0 — scaffold:** pnpm monorepo, shared strict TS config, vitest,
  eslint/prettier, CI on Node 20/22.
- **M1 — brain format (`packages/core`):** zod schemas for memory files,
  brain config, and session events; ULIDs; byte-exact markdown+front-matter
  round-trip; `tb lint` with a prompt-injection heuristics table; structured
  logger with 7-day rotation and privacy redaction; typed errors mapped to
  CLI exit codes.
- **M2 — `tb init`:** scanner/importer (CLAUDE.md, .cursorrules,
  .cursor/rules, AGENTS.md, docs/adr, README architecture sections →
  classed candidate memories, ≥90% text preservation), a gap-driven
  interview (≤10 skippable questions), and output as a PR-ready
  `teambrain/init` branch written through a temporary git worktree — your
  current branch and working tree are never touched.
- **M3 — retrieval (`packages/index`):** SQLite index with an FTS5 mirror
  and sqlite-vec embeddings, checksum-based auto-reindex, local fastembed
  (bge-small) with a lexical-only fallback, and a hybrid BM25 ∪ vector →
  reciprocal-rank-fusion pipeline; `pnpm bench` enforces p95, rebuild, and
  recall budgets on a synthetic 5k-memory brain.
- **M4 — MCP server + daemon (`packages/mcp`):** a stdio MCP server exposing
  `memory_context` / `memory_search` / `memory_propose` / `memory_feedback`
  (bodies rendered as attributed data-not-instructions blocks), and
  `tb serve` — a daemon that watches the brain, keeps the index fresh, and
  answers agents over a local socket; `tb install claude-code` wires it into
  a project idempotently, and `tb doctor` reports health.

The full milestone-by-milestone plan lives in `docs/internal/BUILD_PLAN.md`
(see [Contributing](#contributing)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, project conventions,
and where to find the engineering principles and architecture docs guiding
this build.

## License

[Apache-2.0](LICENSE)
