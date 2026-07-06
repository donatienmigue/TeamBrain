# TeamBrain

Git-native, cross-vendor shared memory for AI coding agents.

Coding agents (Claude Code, Cursor, …) relearn the same lessons every session:
a team's conventions, past decisions, and hard-won gotchas don't carry over
between sessions or across tools. TeamBrain is a shared memory for those lessons
that lives in **your repo**, not a vendor's database — and no TeamBrain server
is ever involved.

- **The brain is a git repo.** Memories are markdown files with YAML
  front-matter (see [FORMAT.md](FORMAT.md)), committed like any other file. Git
  history is the audit trail; pull requests are the approval gate — nothing is
  written to the shared brain without human review.
- **A local daemon serves it to your agent** over MCP, indexing the brain with
  hybrid lexical + vector search.
- **Capture is vendor-neutral and privacy-first.** Thin, fire-and-forget hooks
  record the *shape* of a session (files touched, commands run, outcomes) —
  never raw prompts or diffs — and redact secrets locally before anything
  touches disk. See [SECURITY.md](SECURITY.md).
- **New memories are proposed, never auto-written.** A scheduled CI job reads
  recorded sessions and drafts candidate memories as a pull request; a human
  merges it.

## Quick start (< 5 min)

Requires Node ≥ 20 and git. Run these in the repo you want a brain for.

```sh
npm install -g @teambrain/cli        # installs the `tb` binary

tb init                              # import CLAUDE.md/.cursorrules/ADRs into a
                                     #   teambrain/init branch (main untouched)
#   → review and merge the teambrain/init PR, then:

tb install claude-code               # wire the MCP server + capture hooks into
                                     #   this project's .claude config (idempotent)

tb serve &                           # start the local daemon (index + MCP + capture)
tb doctor                            # verify: daemon reachable, index fresh, hooks live
```

That's it — your agent now retrieves team memories over MCP, and sessions are
captured (metadata only) for later distillation. On the CI side, copy the
workflows from [`ci-templates/`](ci-templates/) to run the distiller and the
weekly digest.

### Everyday commands

```sh
tb audit --last-session   # exactly what was recorded, post-redaction
tb distill                # (CI) cluster recent sessions → open a memory PR
tb retire <id> "reason"   # open a PR moving a memory to retired/
tb digest                 # (CI) post a people-free weekly digest to Slack
tb lint .teambrain        # validate memories (schema, size, injection heuristics)
```

Run `tb --help` or `tb <command> --help` for the full surface and examples.

## Repo layout

```
packages/
  core/      brain format: schemas, IDs, parse/serialize, lint
  index/     retrieval: SQLite + FTS5/vector hybrid search
  mcp/       MCP server + `tb serve` daemon (index, capture spool)
  hooks/     Claude Code capture hook scripts
  redact/    redaction engine + detector corpus
  distill/   CI distiller: collect, cluster, draft, dedup, gate, open PR
  cli/       the `tb` command surface
ci-templates/  GitHub Actions: lint, distill, digest, sessions-branch rotation
```

Every package builds via TypeScript project references (`tsc -b`) and shares one
root `vitest`/`eslint` config.

## Development

```sh
pnpm install
pnpm build              # tsc -b across all packages, in dependency order
pnpm test               # every package's test suite
pnpm test:integration   # end-to-end suites against fixture git repos
pnpm lint               # eslint + prettier --check
pnpm bench              # retrieval performance budgets (p95, rebuild, recall)
```

CI runs build/test/lint/bench on Node 20 and 22 (`.github/workflows/ci.yml`).

## Status

The full V1 loop is implemented and covered by an end-to-end release test
(`tb init → serve → distill → merge → memory_search → retire`):

- **core** — memory schemas, byte-exact parse/serialize, `tb lint` (incl.
  prompt-injection heuristics), logger, typed errors.
- **index** — SQLite FTS5 + sqlite-vec hybrid retrieval, checksum auto-reindex,
  local fastembed (bge-small) with a lexical-only fallback.
- **mcp** — stdio MCP server (the four C3 tools) + `tb serve` daemon;
  `tb install claude-code`; `tb doctor`.
- **hooks + redact** — privacy-first capture hooks and an on-device redaction
  engine gated by a public adversarial corpus.
- **distill** — the collect → cluster → draft → dedup → gate pipeline and
  `tb distill` (opens a proposals PR).
- **digest / doctor / CI** — `tb digest`, `tb doctor --json`, and the
  `ci-templates/` workflows.

The milestone-by-milestone plan lives in `docs/internal/BUILD_PLAN.md`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, conventions, and the
engineering principles guiding this build.

## License

[Apache-2.0](LICENSE)
