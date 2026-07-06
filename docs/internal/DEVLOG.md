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

## M5 — packages/redact + packages/hooks + capture
What: (M5.1) pure, dependency-free redaction engine — gitleaks-subset secret
rules, a Shannon-entropy scanner whose token charset excludes path/URL
punctuation (so git SHAs, hex UUIDs, and file paths never cross the 4.5
bits/char line — hex tops out at 4.0), PII (email/ip/phone, strict-only), and
a gitignore-flavored deny-glob matcher; typed «REDACTED:type» markers. A
133-case public corpus (packages/redact/corpus) is the CI release gate.
(M5.2) Claude Code capture hooks: pure mappers turn raw payloads into C2
events carrying only {kind, path?, exit_code?} — content fields are read to
classify but never stored, with a defense-in-depth key filter dropping
content|old_string|new_string|command; deny-listed paths drop the event; every
event is redacted before it leaves the handler. (M5.3) daemon Spool persists
to ~/.teambrain/spool/<sid>.jsonl and, on session_end, publishes the record to
the never-merged orphan teambrain/sessions branch (push best-effort), capped
at 200MB oldest-first. (M5.4) tb audit prints a record verbatim with a typed
redaction summary; tb install now wires all three hooks.
Accept: pnpm --filter redact test (corpus green); replaying
testdata/sessions/raw-claude.jsonl yields C2-valid, fully-redacted,
content-free events at <20ms p95.
Decisions/tradeoffs: (1) redaction runs in the hook (before the socket/spool),
so the daemon trusts already-redacted local input and doesn't re-scan;
(2) hooks import the daemon socket client via the @teambrain/mcp/hook-client
subpath export, so a hook process never loads better-sqlite3;
(3) the session_end outcome is a commit heuristic (commits ahead of
upstream/main) — turn counting from the transcript is deferred, so V1 emits
committed/unknown but rarely abandoned from the live hook; (4) the deny-glob
matcher covers common .gitignore syntax, not every corner case (noted for a
future hardening pass).

## M6.1 — packages/distill: collect + cluster
What: reads new redacted records off the never-merged teambrain/sessions
branch since a brain.yaml `state.distill.watermark` (git diff of sessions/*),
plus merged-PR metadata via `gh pr list --json`. clusterSignals folds four
signals into deterministic evidence bundles (sessions[] + commits[] map to C1
evidence): same-path struggles across ≥2 sessions, repeated failing commands,
no-hit memory retrievals, agent-proposed candidates (merged by title). PRs are
linked to path clusters by touched file, enriching commit evidence. Sources
(SessionSource, PullRequestSource) are injectable so the whole stage is tested
without git or the network; the git/gh drivers are covered by a temp-repo test
and a fake-exec test. Watermark writes are a yaml document round-trip that
preserves other keys/comments.
Decisions/tradeoffs: (1) failing commands cluster by kind, not command text —
the privacy model never captures the command, so finer grouping is impossible;
(2) no-hit clustering counts empty memory_retrieved events but can't group by
query (query text isn't recorded), so it's a documentation-gap volume signal;
(3) GitLab PR driver deferred (V1 is GitHub-only via gh), noted in prs.ts;
(4) M6.1 has no standalone Accept — the golden pipeline test lands with M6.4;
this stage ships with unit + integration coverage per the DoD.

## M6.2 — distill: draft
What: C5 Provider interface (complete({system,prompt,schema})→zod-validated T or
throws) with a FakeProvider (responder, tests) and a real anthropicProvider
(official SDK, structured outputs via messages.parse + zodOutputFormat, lazy
import, model from brain.yaml → default claude-opus-4-8). draftCandidates makes
one Provider call per cluster using the versioned prompt prompts/distill-v1.md,
fills the deterministic C1 fields (advisory/active/team, evidence from the
cluster) around the model's class/title/body/tags; a rejected call is discarded
and counted. Deps added to distill: @anthropic-ai/sdk + zod (LLM calls stay in
distill per guardrail 4). Tradeoffs: openai/ollama drivers deferred (V1 =
anthropic + fake); the prompt ships beside the built code and loads via
import.meta.url.

## M6.3 — distill: dedup + conflict
What: dedupCandidates embeds each candidate (injected EmbedFn; CLI wires the
index's bge/HashingEmbedder), drops it when cosine ≥0.85 vs an existing active
memory, else runs a pairwise contradiction check (Provider call) against the
top-3 neighbors and, on "contradicts", sets supersedes + a conflict flag.
Novelty = 1−max_sim feeds M6.4 scoring. Existing memories load from
.teambrain/memories only (retired excluded — R5 stance). Tradeoffs: ≥0.85 is a
hard drop (amendment-marking noted as a future option); conflict checks are
best-effort — a failed Provider call is treated as no-conflict (principle 2).

## M6.4 — distill: gate + PR
What: gateCandidates scores evidence_count × novelty(1−max_sim), keeps top ≤10
(deterministic tie-break), and renderPrBody emits a summary table with a
supersedes flag section. pipeline.distill() wires collect→cluster→draft→dedup→
gate with no git side effects (also the --dry-run path). tb distill writes one
file per proposal onto teambrain/proposals-<date> via a temp worktree (main
untouched), advances the watermark on that branch, and opens a PR via gh
(best-effort). Ships ci-templates/lint.yml (tb lint --require-evidence on PRs
touching .teambrain). Accept: golden pipeline test over the new
testdata/sessions/week-fixture (12 sessions → 4 clusters) asserts exactly 3
proposals, duplicate dropped, contradiction carries supersedes + PR flag, all
proposals pass tb lint; a CLI test proves --dry-run makes no branch.

## M5.3 fix — spool commits via git plumbing, not a worktree
What: the sessions-branch publish path spun up a throwaway `git worktree`
(checkout + add + commit + remove + prune ≈ 6–8 subprocesses + temp-dir churn)
per record. Under parallel test load it contended on git/disk and blew the 5s
per-test budget (the spool integration test timed out intermittently). Replaced
it with pure plumbing against a temporary GIT_INDEX_FILE: hash-object -w →
read-tree the branch tip → update-index → write-tree → commit-tree -p tip →
update-ref (compare-and-set). No working tree is ever checked out. Also dropped
a dead `git mktree` call (the empty tree is always known to git). Behavior is
unchanged (same orphan branch, same paths, idempotent re-handling) and faster;
the full suite is stable across repeated parallel runs.

## M7.2 — tb doctor (Tech Brief §6)
What: enriched the daemon heartbeat with self-observability — brain checksum
(freshness), last-reindex time, per-tool hook heartbeats (last event + count,
keyed by C2 `tool`), and retrieval p95 over a rolling window of the daemon's
last 100 context renders. `tb doctor` assembles these into a frozen,
zod-validated DoctorReport (daemon/index/retrieval/hooks/sync/checks), adds a
git branch-sync check (ahead/behind vs upstream), and validates its own output
before printing (human or --json). Exit 0 when reachable, 2 otherwise.
Tradeoffs: retrieval p95 covers the daemon's own context renders, not the
agent's MCP-server-process searches (a separate short-lived process) — honest
partial signal, labelled as such; every field degrades to null from a
partial/absent heartbeat. Accept: --json schema test + observability-field test.

## M7.1 — tb digest (R6)
What: a weekly CI digest. The aggregator consumes AggregateEvent — a projection
that keeps only {ev, data} and structurally drops every identity-bearing field
(the C2 join keys and any future author/user), so the output is people-free by
construction (Tech Brief §4.7). Computes proposed/approved/retired counts,
top-retrieved ids, no-hit search volume (doc gaps), stale ≥90d (active + no
retrieval in the window), and rules-file drift (sha256 of CLAUDE.md/AGENTS.md/
.cursorrules/.cursor/rules vs a brain.yaml baseline). Renders a Slack
incoming-webhook payload; `tb digest [--dry-run]` prints or posts (best-effort,
never throws — the only network egress in the digest path, guideline 4).
Guardrail test: authored fixtures → no per-person data in the output.

## M7.3 — ci-templates
What: shipped distill.yml (weekly cron → proposals PR), digest.yml (weekly cron
→ Slack), sessions-rotation.yml (monthly squash+prune of the teambrain/sessions
orphan branch via commit-tree + force-push, records kept), alongside the
existing lint.yml, plus a README table. Workflows fetch the sessions branch
best-effort and never touch main. Note: actionlint could not be executed here
(installing it was blocked as untrusted external code); the templates were hand-
validated (valid triggers/cron/permissions, shellcheck-safe quoted `run`
scripts) and parse as YAML — run `actionlint ci-templates/*.yml` in CI to
confirm. Also raised testTimeout to 20s for the git-subprocess-heavy mcp/cli
integration suites, which are correct but slow under peak parallel contention.
