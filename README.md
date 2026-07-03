# TeamBrain

Git-native, cross-vendor shared memory for AI coding agents.

> **Status: early-stage.** The brain format is implemented: memory schemas
> with byte-exact parse/serialize, `tb lint` (schema, size limits, and
> prompt-injection heuristics), a structured logger, and the `tb init`
> importer that converts CLAUDE.md / .cursorrules / AGENTS.md / ADRs into
> candidate memories. The MCP server, retrieval index, capture hooks, and
> distiller described below are designed but not yet implemented — nothing
> here is installable as a product yet. See [Roadmap](#roadmap).

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
pnpm build   # tsc -b across all packages, respecting dependency order
pnpm test    # every package's test suite
pnpm lint    # eslint + prettier --check
pnpm bench   # performance budgets (no-op until retrieval ships)
```

CI runs all four on Node 20 and 22 (`.github/workflows/ci.yml`).

## Roadmap

Currently at **M2 — the `tb init` importer**. Done so far:

- **M0 — scaffold:** pnpm monorepo, shared strict TS config, vitest,
  eslint/prettier, CI on Node 20/22.
- **M1 — brain format (`packages/core`):** zod schemas for memory files,
  brain config, and session events; ULIDs; byte-exact markdown+front-matter
  round-trip; `tb lint` with a prompt-injection heuristics table; structured
  logger with 7-day rotation and privacy redaction; typed errors mapped to
  CLI exit codes.
- **M2 (in progress) — `tb init`:** the scanner/importer (CLAUDE.md,
  .cursorrules, .cursor/rules, AGENTS.md, docs/adr, README architecture
  sections → classed candidate memories, ≥90% text preservation) and the
  gap-driven init interview are done; writing the PR-ready `teambrain/init`
  branch is next.

The full milestone-by-milestone plan lives in `docs/internal/BUILD_PLAN.md`
(see [Contributing](#contributing)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, project conventions,
and where to find the engineering principles and architecture docs guiding
this build.

## License

[Apache-2.0](LICENSE)
