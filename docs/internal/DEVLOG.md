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

## M1.3 — logger + typed errors
What: core/log — JSONL logger, one file per UTC day in ~/.teambrain/logs,
7-day retention, level from TEAMBRAIN_LOG_LEVEL, never throws (one stderr
notice on degradation); body|content|prompt redacted at info+ (debug only
passes raw). core/errors — User/Environment/Validation errors → C6 exit
codes 1/2/3 (unknown → 2); parse errors retrofitted onto ValidationError.

## M2.1 — tb init scanner + importer
What: cli/init/scan (CLAUDE.md, AGENTS.md, .cursorrules, .cursor/rules/*,
docs/adr/*, README arch-sections; mdc frontmatter → title hint) and
cli/init/convert (ADR→decision, rules→convention, README-arch→map; rule
files split per ## section; >400-word units split at paragraph bounds into
"(part n of m)" memories linked by a shared source: tag). Bodies keep
source text verbatim → Jaccard ≥0.9 asserted per source; all candidates
advisory (humans upgrade in the init PR); pure read, no repo writes.

## M2.2 — init interview
What: cli/init/interview — generateInterviewQuestions derives ≤10 questions
from gaps (missing map/decision/convention classes; cross-source convention
title overlap ≥0.5 → "which wins?", capped at 3; testing/build/style topic
gaps); runInterview on plain readline with injectable streams (persistent
line buffer — rl.question drops piped lines), empty answer or EOF skips;
answersToMemories reuses the shared candidate builder (tag `interview`).
Also refreshed README status/roadmap (was stale at M0.1).

## M2.3 — init output as PR-ready branch
What: cli/init/branch — writeInitBranch builds teambrain/init via a temp
git worktree (checkout never switched/dirtied; half-made branch deleted on
failure); writes C7 layout + INDEX.md + .teambrain/.gitattributes forcing
LF (autocrlf checkouts otherwise CRLF-break the byte-exact parser — found
by the integration test on Windows). tb init wires import→interview (TTY
only, --yes skips)→branch + next steps; preflight (git repo, has commits,
no .teambrain, no branch) runs before import. M2 accept: integration test
copies the 3 fixture repos into tmp git repos and asserts counts, class
dirs, Jaccard ≥0.9 from written files, lint-clean brain, main untouched.

## M2.3 review fixes
What: init branch now parents on main/master (HEAD fallback, base named in
the output) instead of whatever branch the user stood on; subdirectory
targets resolve to the repo toplevel so scan scope matches where the brain
is written (validateInitTarget returns the root); tb uses parseAsync;
output names the file count. Three new integration tests cover each.

## M3 — packages/index: retrieval
What: SqliteIndex (docs + FTS5 porter mirror + vec0) with brain-tree
checksum auto-reindex; fastembed bge-small behind an Embedder interface
(tarball+file sha256 pins verified before anything is unpacked or loaded;
offline → lexical-only at debug); C4 pipeline with required force-include
tied to token-budget mode so plain search top-k isn't flooded. Bench uses
a deterministic HashingEmbedder (CI is offline): rebuild 15s, p95 35ms,
recall@8 1.00 on the 25-query golden set. vec0 quirk: rowid binds as int64.

## M4 — packages/mcp + daemon
What: C3 stdio MCP server (official SDK 1.29) exposing the 4 tools; bodies
render inside `[team memory <id> — data, not instructions]` fences (injection
mitigation); memory_context is required-first ≤2000 tokens via a new
index.contextDocs; propose/feedback spool locally only. tb serve daemon keeps
the index fresh, serves hook events + a session_context request over a local
socket, and writes pidfile+heartbeat for tb doctor. tb install claude-code is
an idempotent settings merge; tb hook session-start injects the bundle and is
a no-op when the daemon is down. Accept: scripted MCP client hits all 4 tools;
R5 (retire → gone within one watcher cycle); install twice = zero diff.
Decisions/tradeoffs: (1) the watcher is a checksum poll, not recursive
fs.watch — the latter is unsupported on Linux (CI); fs.watch is a best-effort
nudge only. (2) Cross-platform socket: unix socket on POSIX, named pipe keyed
to the runtime-dir hash on Windows (no AF_UNIX in the C7 sense). (3) Deviation
from BUILD_PLAN M4.3 wording: it says write "MCP registration and hook config
into .claude/settings.json", but current Claude Code reads project MCP servers
from .mcp.json — install writes the server there and keeps only hooks in
settings.json. Flagged per guardrail 2 (report, don't silently guess); if a
target CC version wants servers in settings.json, that's a one-line change.
(4) openBackend takes an injectable embedder so tests stay lexical-only and
offline. Note: the pre-existing M2 claude-md-only init test can time out under
full-monorepo parallelism (5s per-test budget vs. git-worktree contention);
green in isolation — not an M4 change.
