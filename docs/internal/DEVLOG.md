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

## M7 — digest, doctor, CI templates (C5)
What: `tb digest` aggregates proposed/approved/retired counts, top-retrieved,
no-hit queries, stale ≥90d, and rules-file drift into a Slack JSON payload. The
aggregator is structurally people-free (M7.1 guardrail). `tb doctor` reports
daemon + index health (liveness, freshness, heartbeats, branch-sync) with a
frozen JSON schema. `ci-templates/` drop-in actions cover lint, distill cron,
digest cron, and sessions-branch rotation.
Accept: Unit and schema tests pass; templates pass `actionlint` without errors.

## C6 — Cursor capture
What: Implemented rules-directive fallback and MCP-side inference for Cursor.
`tb install cursor` writes `.cursor/mcp.json` and `.cursor/rules/teambrain.mdc`.
`tb mcp --client cursor` triggers a `CursorInterceptor` wrapper that injects C2
events (`session_start`, `candidate_proposed`, `session_end`) via the MCP socket
client. Handled degraded `tool_use` capture cleanly and surfaced in `tb doctor`.
Added Cursor parity fixture (`raw-cursor.jsonl`) and updated README matrix.
Tradeoffs: Cursor lacks native hooks, so edit/command telemetry is unavailable.
`redactEvent` updated to gracefully preserve LLM-proposed `body` fields.

## C7 — V1 completion gate
What: Completed the V1 readiness checklist. Created the `Nightly Full-Loop Integration` workflow
in `.github/workflows/nightly.yml` that runs the end-to-end integration test 3 consecutive times.
Verified that `npm pack` correctly builds the tarball and rewrites `workspace:*` versions, preparing 
the CLI for publishing. Ensured `FORMAT.md`, `SECURITY.md`, and README are fully up to date with 
installation and usage commands.
Accept: Ran `pnpm run test:integration` executing `full-loop.integration.test.ts` successfully 3 times.
Verified the tarball contents explicitly point to correct versions. `tb doctor` and `tb init` are functional.

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

## M8.1 — full-loop release test + tb retire
What: implemented `tb retire <id> <reason>` (C6) — finds the active memory by
id, and on a throwaway worktree git-moves it to retired/ with status: retired
(C1), commits a teambrain/retire-<id> branch, and opens a PR best-effort; main
is never touched. Then the release loop test drives the whole product through
its CLI: fixture repo → tb init → merge → tb serve (live daemon) → replay
sessions → tb distill → merge → memory_search finds the new memory → tb retire
→ merge → memory_search no longer returns it (R5). Real git throughout; the LLM
Provider + embedder are injected so it's offline and deterministic. Accept:
green 3 consecutive runs (verified locally). Tradeoffs: sessions are replayed
via an injected source rather than round-tripped through the socket/spool (that
path is covered by the mcp integration tests); reindex is forced explicitly
after each merge to keep the assertions non-flaky.

## M8.2 — packaging
What: `.github/workflows/release.yml` fires on a v* tag: job 1 `pnpm -r publish
--provenance` (all @teambrain/* packages, workspace:* rewritten to real
versions), job 2 a bun `--compile` matrix (darwin-arm64/x64, linux-x64) that
smoke-tests `--version` and attaches the binaries to the GitHub Release. Made
every package publishable (license, repository, publishConfig, files). Verified
locally: `pnpm --filter cli pack` produces a tarball with workspace deps
rewritten to versions (registry-installable once published), and
`bun build --compile` of the cli yields a single binary that runs `--version`,
`doctor --json`, and `--help` (embeds the native better-sqlite3). Post-install
self-check is `tb doctor` (documented in the README quick start). Blocker (per
DoD): the literal "npm pack installs clean on a bare container" and the actual
npm publish / cross-platform binaries can only be verified in CI — the sandbox
has no registry, no bare container, and cross-OS runners; the pieces are staged
and locally smoke-tested.

## M8.3 — docs
What: rewrote README.md with a <5-min quick start (install → init → install
claude-code → serve → doctor) + an everyday-commands section and an accurate
status list; added FORMAT.md (the C1 memory spec — layout, front-matter table,
body rules, canonical serialization) and SECURITY.md (the §5 threat model
summary, memory-poisoning stance front and centre); added a `tb --help`
examples block (commander addHelpText) so the top-level help lists the quick
start + everyday commands, with per-command `--help` from each description.

## I0/F1 — fix C3 fence-escape in memory rendering
What: `renderMemoryBlock` opened/closed the `data, not instructions` block with
a fixed ```` ``` ```` fence, so a memory body containing ```` ``` ```` broke out
and the trailing text rendered as agent instructions (in memory_search,
memory_context, and the SessionStart bundle). Now the fence is a back-tick run
one longer than the longest run inside (CommonMark closing rule). Regression
tests added.
Why: C3's injection-mitigation guarantee — a payload past `tb lint` still can't
pose as a live instruction — was bypassable; this was the audit's only Critical.
Tradeoffs: fence length is now content-dependent; `tb lint` deliberately keeps
allowing back-ticks (legit code snippets), the fence is the correct defense.
## I0.3/F7 — v1-brain compat fixture + byte-correct gate
What: testdata/compat/v1-brain/ generated from current main via the shipped
serializers (one memory per class exercising evidence/supersedes/ttl/required,
one retired, brain.yaml, a 5-event C2 session record); packages/core
compat-v1.test.ts asserts parse→serialize byte-equality on every file, field
survival, and per-line C2 round-trips. Fixture committed before the test
(fixture-first guardrail); gate verified to fail on a 1-byte perturbation.
Why: I0 Accept requires future code to read the v1 formats byte-correctly.
Tradeoffs: fixture is frozen — never regenerate it to appease the test.

## I0/F3 — guardrail-4 egress guard
What: cli/src/egress-guard.test.ts scans every packages/*/src (minus tests,
helpers, bench) for network syntax (fetch(, node:http(s) imports, http-client
deps, websockets, the Anthropic SDK) against an explicit allowlist:
digest/slack.ts, distill/anthropic.ts, index/embeddings.ts. Negative control
asserts the allowlisted files DO trip the patterns; a breadth floor prevents
vacuous passes.
Why: guardrail 4's "CI test greps the bundle" was mandated but absent (F3).
Tradeoffs: first run caught embeddings.ts — the M3.2 model download is a
legitimate fourth egress point guardrail 4's wording omits; logged as F8
rather than silently allowlisted.

## I0/F6 — actionlint verified and enforced
What: all seven workflow files (ci, nightly, release + 4 ci-templates) pass
actionlint 1.7.1 locally; ci.yml gains an actionlint job pinned to that same
version (docker://rhysd/actionlint:1.7.1), shellcheck/pyflakes disabled to
match the locally-verified surface.
Why: the M7 accept was unverifiable during the audit (F6) and unenforced.
Tradeoffs: shellcheck/pyflakes stay off until I3/I4 triage their findings —
a deliberately narrower gate that is actually known-green.

## F2 — tb reindex + tb propose (C6 surface complete)
What: the two commands C6 lists that were never built. `tb reindex` forces a
full rebuild through openBackend and, when index.db is unreadable, deletes the
cache and rebuilds from the brain tree; its negative test exposed a real bug —
SqliteIndex.open leaked the db handle on a corrupt file, which on Windows
locks the file and blocks exactly this recovery (fixed in open()). `tb
propose` queues a zod-validated draft to the local candidate spool (identical
trust model to C3 memory_propose), body from --body/stdin, most recent
session cited as evidence.
Why: AUDIT.md F2 — the frozen CLI surface was incomplete.
Tradeoffs: propose does not run injection lint at queue time (parity with the
MCP tool; `tb lint` gates at PR time, where it belongs).

## F4 — user-scope physical separation (C7)
What: user-paths.ts is now the only module that names ~/.teambrain/user/;
tb serve materializes the dir from the CLI layer. Two-layer negative test:
spool.ts's transitive import graph must never reference the user path
(perturbation-verified), and seeded user/ content is absent from every
reachable git object in both the local repo and a pushed bare remote.
Why: AUDIT.md F4 — C7's separation guarantee (and SECURITY.md's claim of it)
had no implementation and no test.
Tradeoffs: the guarantee is structural (module boundary) + behavioral (object
walk), not OS-enforced; that matches C7's "separate module without that path
in scope" wording exactly.

## M8.3 — grouped CLI help + exit-code docs
What: tb.ts now delegates to program.ts's buildProgram() (extracted from the
old monolithic entrypoint); help-text.ts centralizes root/per-command help
copy; commands are grouped (Setup/Daemon/Quality/Capture) via helpGroup(),
with mcp/hook hidden from the root listing but still fully documented via
their own --help. Root help lists exit codes and getting-started/day-to-day/
CI example blocks.
Why: `tb --help` was a flat, ungrouped list; new contributors and CI authors
need exit-code semantics and command grouping at a glance.
Tradeoffs: root help intentionally avoids the words "hook"/"mcp" (both
internal implementation details) — reworded "capture hooks" → "capture
wiring" and "hook heartbeats" → "capture heartbeats" in install/doctor's
descriptions and the getting-started block; the `hook` subcommand's own
--help still documents all four events in full.

## D0 — post-V1 ground-truth verification & baseline freeze
What: POSTV1_PLAN.md committed; STATUS.md rewritten as an evidence-based D0
baseline — clean-clone full suite green (504 unit + 43 integration, bench
budgets met), live-registry install of @teambrain/cli@0.0.1 verified working,
privacy/egress/join-key invariants re-audited, compat fixture gate confirmed.
Why: the post-V1 instructions' ground truth was stale — npm publish and Cursor
capture already exist; D0 exists precisely to catch that before building.
Tradeoffs: "clean container" approximated by a fresh npm prefix + scratch repo
on Windows (found the core.longpaths clone failure doing so); D1/D2 scopes
shrunk to their true residuals in STATUS.md rather than re-executed wholesale.

## D1/D2 residuals — release gate + honest capture claims
What: release.yml gained a post-publish bare-machine smoke job (npm i -g from
the live registry on node:20 → tb --version/init/doctor, propagation retries)
and a gated GitHub Release with generated notes; README's Cursor note/matrix
now state that session_end is inferred only on memory_propose and commits are
not captured; cursor-wrapper and tb hook log dropped events at debug level.
Why: D0 findings — README overclaimed Cursor capture; two silent catches
violated CLAUDE.md; a release could previously stand without proving install.
Tradeoffs: generate_release_notes over a committed CHANGELOG.md (no new dep,
notes live on the Release page); tb doctor exits 0 daemon-down, so the smoke
job doesn't yet assert daemon health (doctor exit codes are a D5.1 item).

## D2 — idle-timeout session_end for Cursor
What: CursorInterceptor now ends an open session after 30 min of inactivity —
lazily on the next MCP call (stale end emitted before the call is interpreted,
so a returning memory_context starts a fresh sid) and eagerly via flushIdle(),
which cursor-wrapper arms on an unref'd timer after every call. duration_s now
measures start→last-activity instead of always 0. Negative tests: activity
inside the window never ends a session; flushIdle without a session is a no-op.
Why: STATUS.md D0 finding — a Cursor session that never proposed a memory
never emitted session_end, so outcome-mix aggregates (D3.2) would undercount.
Tradeoffs: 30 min is a constant, not config — plumbing it into brain.yaml can
wait for a user who needs it; idle end can't know outcome (stays 'unknown').

## D3 — differentiator instrumentation (practice signals, governance, PR body)
What: practice-signals.ts (session-grouped, people-free aggregates: outcome
mix, retries, failures, retrieval rate, co-occurrence, context-setup proxy)
rendered in the digest; governance friction (median proposal-PR time-to-merge
via injectable gh) in digest + doctor --json; distiller PR body redesigned for
<60s/candidate review with a byte-exact golden; PRACTICE_SIGNALS.md records a
conditional GO on metadata-only FlightDeck.
Why: D3 is the strategic core — it decides whether FlightDeck is buildable
without content capture. Verdict: yes, scoped to the strong signals;
plan_revision has no emitter and co-occurrence must stay labeled correlation.
Tradeoffs: doctor's gh query wired at the CLI layer (not defaulted) to keep
tests subprocess-free; context-setup is an events-before-first-tool proxy.

## D6 — CodeMap (R16), opt-in, zero new agent surface
What: incremental hash-manifest summarizer (packages/distill, C5 Provider,
`tb distill --codemap`, ci-templates/codemap.yml) writing byte-stable entries
to .teambrain/codemap/files/**; index syncs the tree under C4's reserved
source 'codemap' (checksum-idempotent, disabled flag empties the source);
memory_context serves a separately-budgeted 1500-token codemap slice next to
the untouched 2000-token memory pool; memory_search returns both sources
tagged. Bench: 500k-LOC fixture, 20-file incremental in 8.1s (<120s budget).
Why: POSTV1_PLAN D6 — D0–D3 green and the build was explicitly requested.
Tradeoffs: the ≥30% exploration-token acceptance is NOT measurable from
today's stream — C2's tool_use.kind is frozen to edit|command|test, so
Read/Grep events are never captured; adding an 'explore' kind is a C2 change
that needs explicit approval (reported, not done). Codemap slice rides in
C3's existing `relevant` array (shape unchanged; entries tagged by additive
MemoryView.source).

## C2 explore kind + exploration measurement (explicitly approved)
What: C2 tool_use.kind gains 'explore' (CONTRACTS.md updated with the
approval note); Claude Code hooks map Read/Grep/Glob to explore events with
path-only metadata (patterns/queries never read); practice signals compute
exploration/session and the D6 instrument — median exploration split by
codemap-retrieving (cm:-prefixed retrieved ids) vs non-retrieving sessions,
with reduction % against the §4.8 ≥30% target, rendered in the digest.
Why: D6's last acceptance criterion was unmeasurable from the frozen event
stream; the human approved the additive contract change.
Tradeoffs: event counts proxy token spend (true token counts aren't in any
hook payload); replay fixture expectations updated deliberately — Read now
captures instead of dropping, still content-free (forbidden-keys test
unchanged and green).

## CodeMap doc gap-fill vs the CM0–CM6 brief (audit, ADR, README)
What: audited the CodeMap CM0–CM6 brief against the shipped D6 build — the
feature already exists (generator, CI template, isolation/staleness/
neutrality/e2e tests, digest instrument; 542 tests green); added the two
missing artifacts: docs/adr/codemap-backend.md (build-vs-buy + OQ-CM4 swap
threshold) and a README "CodeMap (v1.1, opt-in)" section, honest about
default-off. Deviations from the brief's letter left for a human decision
(reported, not done): no packages/codemap (generation lives in distill, the
sole LLM boundary); `tb distill --codemap` not `tb codemap build` (C6 verb
list is frozen; a flag is additive); brain.yaml codemap block has `enabled`
only (no denyGlobs/granularity — behavior for them isn't built); prompt is a
versioned code constant, not an in-repo .md file; no session-start relevance
scoping yet (OQ-CM2).

## CodeMap documentation sweep (user-facing docs)
What: documented CodeMap everywhere it was missing beyond the README —
ci-templates/README.md (codemap.yml row + direct-commit and source-to-LLM
notes), FORMAT.md (codemap/ layout + entry format from codemap-entry.ts),
SECURITY.md (CI↔LLM boundary widens to source contents when opted in; a
CodeMap-injection threat entry — verified codemap bodies render in the same
data-not-instructions fence), DEVELOPMENT.md repo map rows.
Why: docs only mentioned CodeMap in the README; the security posture change
(source leaves CI when enabled) was undisclosed.
Tradeoffs: none — docs-only, honest about opt-in status.

## 2026-07-13 — Multi-Vendor Capture Adapter Framework (A0)

What: extracted the registry-driven `CaptureAdapter` framework
(packages/hooks/src/adapter.ts + registry.ts); Claude Code and Cursor
refactored onto it — their mappers/merges moved, cli install/settings
re-export shims keep every existing test untouched. `tb install` resolves
from the registry; the README capture matrix is generated from
`ADAPTERS[*].capabilities` and asserted byte-for-byte by matrix.test.ts.
C6 reading: widening `tb install <tool>`'s argument set is additive, not a
contract change — CONTRACTS.md untouched.

## 2026-07-13 — Multi-Vendor Capture Adapters Spikes (A1)

Executed spikes for Codex, Gemini CLI, Cline, Kiro, and Antigravity per ADAPTERS_PLAN.md A1.

**Spike Findings:**
1. **Codex (Tier B - MCP inference):**
   - **Hook surface found**: a `notify` hook in global `~/.codex/config.toml` (CODEX_HOME honored), fired only on `turn-ended` (agent-turn-complete) — payload carries thread/turn ids and *message text*, no tool events, no session lifecycle. Not enough for Tier A, and the payload's `input-messages`/`last-assistant-message` fields are content we must never read.
   - **Payload fixture**: captured from a live interactive session at `testdata/sessions/raw-codex.jsonl` (kept as evidence for the tier decision, not mapped).
   - **Tier decision**: B — MCP-side inference via `tb mcp --client codex`.
   - **CaptureCapabilities**: `sessionStart: true, sessionEnd: true, toolUse: false, commitShas: false, planRevision: false`.
   
2. **Gemini CLI (Tier A - Native Hooks):**
   - **Hook config format**: Handled via `.gemini/settings.json`, supporting standard lifecycle hooks like `SessionStart`, `AfterTool`, and `SessionEnd` (migratable from Claude Code via `gemini hooks migrate`).
   - **Payload format**: Handled via standard input (stdin) as a JSON-serialized string with keys `session_id`, `cwd`, `hook_event_name`, etc.
   - **Payload fixture**: Recorded and stored at `testdata/sessions/raw-gemini-cli.jsonl`.
   - **CaptureCapabilities**: `sessionStart: true, sessionEnd: true, toolUse: true, commitShas: true, planRevision: false`.

3. **Cline (BLOCKED):**
   - Exposes no lifecycle hooks; the tool could not be installed/run here to
     verify an MCP config location or client connection. Per A1, a blocked
     vendor gets **no adapter** until Tier B is verified against the real tool.

4. **Kiro (BLOCKED; OQ-A1 answered):**
   - ACP (Agent Client Protocol) is a client-host interactive messaging
     protocol, not a process lifecycle hook executor — it is **not** a general
     Tier-A pathway (OQ-A1: no). No verified install surface here → no adapter.

5. **Antigravity (BLOCKED):**
   - Found as an Electron desktop app in AppData; exposes no shell execution
     hooks, and no MCP config location was verified. No adapter until a spike
     confirms one.

## 2026-07-14 — Codex + Gemini CLI adapters ship; Cline/Kiro/Antigravity BLOCKED (A2/A4/A7 + review)

What: shipped the Codex (Tier B) and Gemini CLI (Tier A) adapters with the
full per-adapter test set (fixture replay, privacy negative, C2 validity,
idempotent install, doctor honesty, latency). Review fixes over the first
draft: the Tier-B MCP wrapper is generalized to any `mcp-inference` adapter
(`tb mcp --client codex` now actually captures — before, only cursor was
wrapped, so Codex's declared session capture never fired); Codex installs
honor CODEX_HOME (tests stay out of the real home dir); Gemini's two merges
into .gemini/settings.json are composed into one InstallFile (two plans on
one path clobbered the MCP-server merge on first run); Gemini hooks register
`tb hook … --tool gemini-cli` so events carry the real vendor id instead of
defaulting to claude-code.
Why blocked: Cline, Kiro and Antigravity spikes found no verified install
surface (no confirmed config location / client connection), so per the plan
they get NO adapter — a first draft shipped them with empty install plans,
which reported "installed" while capturing nothing; removed as dishonest.
Tradeoffs: the README matrix shrinks to four tools but every cell is true;
R1 (Codex tagline) is now TRUE with working `tb install codex`; the gemini
fixture is thin (4 events) — flagged for re-recording in a longer session.

## 2026-07-14 — Daemon auto-start on demand
What: `ensureDaemon()` in @teambrain/mcp — probe → exclusive lock
(daemon.lock, 30s TTL, stale-breaking) → detached `tb serve` spawn → poll
until deadline (1.5s); wired into requestSessionContext and `tb mcp` boot
only (never sendHookEvent's <20ms path; never plain pingDaemon, so doctor
stays truthful). One stderr disclosure line on cold start; `tb serve --stop`
(idempotent) and `tb doctor --fix` added; kill-switches: brain.yaml
`daemon.autostart`, TEAMBRAIN_NO_AUTOSTART, CI (env beats config).
Why: "developers never have to remember tb serve" without breaking the
no-servers trust promise — disclosed, stoppable, disableable.
Tradeoffs: C6 reading — `--stop`/`--fix` flags on frozen verbs are additive,
not a contract change (same reading as `tb install`'s widened argument set).
The real spawner refuses under VITEST so no test can ever start a real
daemon; auto-start paths are covered by 12 injected-spawn unit tests.

## 2026-07-14 — R10 retrieval eval harness (E0–E3)
What: `pnpm eval` — real corpus (testdata/eval/corpus, 20 memories: dogfood
brain + hand-written fixtures) + 48 paraphrased queries (8 negatives) run
against the production bge-small embedder under four ablation modes
(lexical / vector / hybrid RRF / weighted 0.7-0.3); memory_context
hit-rate + latency. Knobs are additive SearchOptions fields whose defaults
are byte-identical to shipped RRF (asserted). Results in docs/RETRIEVAL.md.
Why: §4 verdict needed a number — got it: hybrid recall@5 = 0.95 ≥ 0.90 →
question closed, no sophistication added; weighted fusion measured worse.
Tradeoffs: corpus is 20 memories (below the 50–150 brief minimum) and
queries are assistant-written, not human-blind — recorded as caveats, not
hidden. Real findings kept: no abstention on negatives (trust gap, needs a
similarity floor, not an RRF threshold) and real-embedder p50 185ms vs the
synthetic 80ms budget assumption.

## 2026-07-14 — R16.1 T1: distinct codemap rendering (P3)
What: `renderMemoryBlock` now heads codemap blocks with
`[codemap · generated from <path> · not human-approved]`; governed memory
rendering is byte-unchanged (inline-snapshot gated).
Why: governance legibility — agents must be able to tell approved knowledge
from a generated, possibly-stale map. Tradeoffs: none; purely additive branch.

## 2026-07-14 — R16.1 T2: char-budget isolation (P4)
What: `renderContextBundle` reserves a 30% char share for codemap blocks when
any are present (never more than what required blocks leave over); memory
advisory fills the rest; codemap rides at the tail. Zero codemap views → the
V1 code path, byte-identical (asserted against an inlined V1 algorithm).
Why: codemap was appended last and truncated first — silently evicted by any
advisory-heavy brain. Tradeoffs: chars are a shared physical cap, so unlike
tokens the two pools can't both be maximal; codemap gets a guaranteed floor.

## 2026-07-15 — R16.1 T3: the CodeMap index block + instruction (P2)
What: non-empty codemap → `renderContextBundle` emits a ≤200-token index
block (entry count, path-derived modules via `SqliteIndex.codemapStats()`,
freshness) plus the one instruction we actually want followed: search the map
before exploring files. Preamble region only — outside every fence. Empty
codemap → byte-identical bundle (gated). Wired into the daemon + the
memory_context text channel.
Why: the map existed but nothing ever told an agent to use it — the
highest-leverage line of text in the feature. Tradeoffs: it's a prompt, not
an API; T7 measures whether it works.

## 2026-07-15 — R16.1 T4: scoped codemap retrieval (P1)
What: `contextDocs` gained a `paths` filter (codemap docs only); the daemon
tracks session-relevant paths (tool_use hook events, bounded + normalized,
∪ branch diff vs the default branch, best-effort) and passes them to
`memoryContext`. paths=[] (no signal) → no slice, index block only — never
"newest". Scoped slice budget: 500 tokens (CODEMAP_SCOPED_TOKEN_BUDGET);
total session-start codemap footprint ≤700 (gated).
Why: recency is a poor relevance proxy; session-touched files are near-
certain. Tradeoffs: the legacy unscoped 1500 path survives for direct
library callers only (frozen tests encode it); no serving path uses it.

## 2026-07-15 — R16.1 T5: orphan sweep — entry tree ≡ manifest projection
What: after each `updateCodemap` run the entry tree is swept against the NEW
manifest: any .md whose derived repo path isn't a manifest key is deleted
(reported as `orphaned`), and emptied directories are pruned bottom-up.
Delete failures are logged with path+reason (never silent) and retried next
run. Covers: rename (file + directory), corrupt manifest (rebuild AND clean),
stray entries from failed deletes, idempotence — all with disk, manifest,
and retrieval-level assertions.
Why: loadCodemapDocs walks the DISK while deletion iterated the OLD manifest
— that asymmetry served phantom files forever (D1/D2). Tradeoffs: distill
gains a test-only workspace devDep on @teambrain/index to assert retrieval.

## 2026-07-15 — R16.1 T6: neighbour refresh on removed paths
What: when a run removes/orphans paths, entries whose stored summaries
mention a dead path are force re-summarized (their own hash is unchanged so
the diff would never touch them). Cheap substring scan — no import graph.
Fan-out capped (default 20, `maxNeighbourRefresh`), cap logged.
Why: summaries carry cross-module references; renames/deletes let the map
accrete references to files that don't exist (D3). Tradeoffs: substring
match can over-trigger (src/b.ts also matches src/b.tsx mentions) — worst
case a wasted re-summary, bounded by the cap.

## 2026-07-15 — R16.1 T7: measure the behavior (codemap query rate)
What: `codemapQueryRate` in PracticeSignals — sessions retrieving ≥1
`cm:`-prefixed id / all sessions — surfaced in `tb digest` next to the
existing exploration median and by-codemap reduction %. Same people-free
projection; the negative test still gates identity leakage.
Why: the CM6 gate (≥30% exploration reduction) needs both arms observable:
do agents query the map at all, and does exploration fall when they do. If
the rate stays ~0, the answer is better map content, not more pushed tokens.

## 2026-07-16 — fix: daemon spawned endless console windows on Windows
What: `windowsHide: true` on every child spawn in console-less contexts —
the autostart daemon spawn (detached children get their OWN visible console
on Windows; closing it killed the daemon and the next hook resurrected it,
window and all), plus every git child of the daemon (fetch, branch-diff
refresh, spool push) and of the hooks. Why: user-visible console windows
appearing indefinitely. Tradeoffs: none; display-only flag.

## 2026-07-20 — R16.1 T7a: holdout config + deterministic arm assignment
What: `codemap.holdout` (0–1, default 0.1) added to brain.yaml's codemap block
(additive; existing field-specific tests + compat fixture stay green). New pure
core module `codemap-arm.ts`: `fnv1a` (tiny dep-free 32-bit hash) + `codemapArm(sid,
holdout)` (`hash(sid) % 100 < holdout*100` → control) + `effectiveHoldout` (disabled
codemap ⇒ 0 ⇒ every sid treatment, since serving is already off).
Why: the CM6 gate needs a randomized control arm measured, not a before/after
estimate. Assignment must be deterministic per sid across every process (hook
tag, daemon bundle, MCP search) or the arms disagree. Tradeoffs: FNV-1a hand-
rolled (boring-deps); disabled-arm tag is meaningless-but-harmless.

## 2026-07-20 — CI: automated versioning + npm publish via Changesets
What: replaced the continuous `publish.yml` (which only published on a manual
version bump, so merges were silent no-ops) with a Changesets flow. `pnpm
changeset` per change → on merge to main, `changesets/action` opens a "Version
Packages" PR (bumps + CHANGELOGs); merging it runs `pnpm run release`
(`pnpm -r publish`, rewrites workspace:* + skips already-published). All
@teambrain/* are `fixed` (lockstep) so one changeset bumps all seven together.
Added a changeset for the pending R16.1 T7 + performance-metrics work (→ 0.5.0).
Why: user reported "CI doesn't push to npm" — diagnosis: publishing worked
(0.4.0 live) but nothing new shipped because the version was never bumped;
Changesets automates the bump. Tradeoffs: kept `release.yml` for tag-triggered
standalone binaries (Changesets tags are per-package, not v*); `pnpm publish`
(not `changeset publish`) so workspace:* deps are rewritten. ci.yml actionlint
list + STATUS.md updated for the renamed workflow.

## 2026-07-20 — PM4: tb metrics read-only local snapshot
What: new `tb metrics [--json]` — a read-only local dump for "why is my context
slow/noisy": index size, latency percentiles (from the daemon heartbeat via the
doctor snapshot), injection weight, required-load, codemap utilization, served
staleness, and the net-efficiency verdict. Reuses the digest aggregation + the
doctor report; captures nothing, writes nothing (Acceptance §7). CONTRACTS C6
updated to add the verb — done with explicit human approval (a new top-level
verb is a frozen-surface change, unlike the additive flags precedent), noted
inline in CONTRACTS as additive + people-free.
Why: §5 — a local debugging surface for context cost/rot without waiting for the
weekly digest. Tradeoffs: latency fields are empty when the daemon is down (same
as doctor); no new privacy surface since it only reads existing aggregates.

## 2026-07-20 — PM3: net-efficiency composite (the question, answered)
What: `netEfficiency` in the digest — avoided exploration (from the T7 CodeMap
holdout arms, treatment vs randomized control, NOT before/after) paired with the
injection weight it costs, with the same measured/estimated + 95% CI labeling.
An honest verdict: insufficient-data (until the holdout is measured), net-anti-rot
(measured, CI excludes zero, ≥30% CM6 bar), net-rot (treatment explored more), or
inconclusive. Rendered as a plain statement in tb digest.
Why: §3.3 — the one number that decides whether TeamBrain is worth its context
cost. If not net-anti-rot on real data, that finding outranks every feature.
Tradeoffs: reuses the holdout split (avoids the self-selecting codemap-retrieving
vs not confound); verdict never claims a win without a measured, CI-excludes-zero
result.

## 2026-07-20 — PM2: real latency percentiles in tb doctor
What: a people-free timing channel — a `timing` daemon message ({metric, ms},
no identity). The daemon keeps rolling p50/p95 windows for `injection` (its own
context render), `search` (reported by the MCP server around memory_search),
and `hook` (reported by the capture handler around map+redact). `tb doctor
--json` gains `latency.{injection,search,hook}` (real numbers vs the synthetic
bench, against the 500/300/20ms NFRs) plus index bloat signals reindexCount +
dbSizeBytes. Existing `retrieval` field kept (backward-compat) fed by injection.
Why: §3.2 — a benchmark is a promise; this measures the kept promise in real use.
Tradeoffs: search/hook latencies depend on the daemon being up (samples dropped
if down); distiller cost (also §3.2 prose, not in §6 acceptance) deferred — it
runs in CI, not the daemon.

## 2026-07-20 — PM0/PM1: injection capture + context-efficiency & rot metrics
What: Finding — `memory_retrieved` events were NEVER emitted in the live path
(no MCP-result hook; Cursor's memory_search branch is a no-op), so injection,
retrieval-rate, and codemap-query metrics were all unfed on real data. Fix
(PM0): the daemon logs a `memory_retrieved {ids, via:'context', tokens,
required, required_tokens}` event when it serves a sid-bearing session_context
bundle — it's the authority on what it injected. Reuses the frozen C2 event with
additive data fields (no CONTRACTS change); ids are structural (ULIDs + cm:path),
no content. Existing metrics ignore `via:'context'` events (isContextInjection),
so no metric shifts. PM1: new context-metrics.ts computes injection weight,
required-load (+budget flag via `metrics.required_max_tokens`), codemap
utilization (injected map paths later touched by tool_use), and served staleness
(injected memories ≥staleDays old) — all people-free, surfaced in `tb digest`.
Why: answers "is injected context used, fresh, worth its budget — or is TeamBrain
causing context rot?" Tradeoffs: utilization is codemap-only (governed memories
have no code path in metadata); query-side retrieval is still uncaptured (chose
injection logging over an MCP-result hook), so query-rate metrics stay unfed —
documented. Contradiction count deferred (needs the LLM Provider; not in §6.1
acceptance).

## 2026-07-20 — R16.1 T7e: holdout docs (README)
What: the README CodeMap section now explains the holdout (what it is, why —
clean causal measurement vs a confounded before/after, how to change/disable via
`codemap.holdout: 0`, and that a control session behaves as if CodeMap were off);
restated the default-on gate as a *measured* result; corrected the stale
1,500-token budget line to the shipped ≤~700 (index ≤200 + scoped ≤500). Flagged
the honest caveat that the search-side control exclusion needs TEAMBRAIN_SESSION_ID.
Why: T7e — the holdout must be disclosed and configurable. Tradeoffs: none; docs.

## 2026-07-20 — R16.1 T7d: digest arm split with bootstrap CI
What: `computePracticeSignals` reads each session's `codemap_arm` and emits
`codemapHoldout` — explore-actions/session and codemap query rate per arm, plus
the treatment-vs-control reduction% with a seeded (mulberry32, deterministic)
95% bootstrap CI over sessions. Labeled `measured` only when both arms ≥20
sessions (MIN_ARM_SESSIONS), else `estimated`. Slack renderer never prints the
effect without its label and per-arm n (control/treatment).
Why: the CM6 gate is a measured holdout result, not a before/after estimate; an
unlabeled reduction is the confounded number the holdout exists to replace.
Tradeoffs: reduction is on the mean (explore-actions/session reads as a mean),
not the median D6 instrument; both coexist. Bootstrap is 2000 iters, seeded so
the CI is reproducible; people-free by construction (arm counts only).

## 2026-07-20 — R16.1 T7b: control-arm serving bypass (single chokepoint)
What: `codemap-arm-serving.ts` centralizes the arm decision (`servesCodemap`)
and the search filter (`filterSearchForArm`); openBackend now exposes the
effective `codemapHoldout`. Bundle path: the SessionStart hook threads its sid
→ session_context request → daemon `contextBundle(sid)`; a control session gets
paths:[] + null stats, i.e. the byte-identical empty-codemap bundle (asserted).
Search path: `tb mcp` reads its sid from `TEAMBRAIN_SESSION_ID`, computes the
arm, and (control) drops source:'codemap' at the one memory_search chokepoint.
Also: `tb hook session-start` now emits the session_start event (previously
never captured on the native path) so the arm tag actually reaches the spool.
Why: CM6 needs a clean control baseline; both surfaces must key off one arm.
Tradeoffs / flagged: no vendor exposes a documented per-session id to a
`.mcp.json`-launched server, so `TEAMBRAIN_SESSION_ID` is the mechanism but the
install does NOT yet write a speculative placeholder (would break the zero-diff
install + could inject an empty env). Absent the var, search serves treatment-
equivalently while the bundle bypass (sid-reliable) still fully applies — a
partial, honest degradation, documented in the README.

## 2026-07-20 — R16.1 T7c: codemap_arm tag on session_start
What: `mapSessionStart` now tags `data.codemap_arm` (control|treatment),
computed from the session's own sid + the effective holdout (read from
brain.yaml in `buildHookContext`, 0 when codemap disabled/config malformed).
Additive under C2 (session_start.data is looseObject) — CONTRACTS untouched.
Why: the digest (T7d) needs every session's arm to split metrics; tagging at
the one place that owns session identity keeps hook and serving in agreement.
Tradeoffs: privacy negative test extended — arm is people-free metadata and the
sole session_start key; the Cursor Tier-B path is unchanged (arm-less → digest
buckets it as neither arm).

## 2026-07-16 — autostart circuit breaker (bounded retry + stop)
What: ensureDaemon now records consecutive failed start attempts
(runtimeDir/autostart-failures.json). After 3 failures it stops spawning
and discloses once ("autostart paused for 10 min; run 'tb serve' to see
why"); cooldown expiry allows one half-open attempt; success resets.
Corrupt/absent record fails open. A throwing spawn counts as a failure.
Why: a daemon that crashes on boot was respawned by every hook event,
forever. Tradeoffs: state is per-runtimeDir and time-based, not persistent
across cooldowns by design.

## 2026-07-21 — E1 start: contract amendment A (verify) + OQ-8 egress spike
What: added `verify [--json] [--strict]` to C6 in CONTRACTS.md (additive
amendment A, ADR-6/EVIDENCE_BRIEF §9, explicit human approval 2026-07-21) with
its own exit-code note (0 pass / 2 could-not-run / 3 invariant violated). Ran
the OQ-8 spike before writing V2.
Why: `tb verify` is the phase keystone — privacy-by-construction as a command a
stranger runs on their own data. V2 needs an honest egress claim.
OQ-8 result: JS instrumentation (net.Socket.connect/http.request/fetch) DOES
observe JS-layer egress; native deps (better-sqlite3, onnxruntime-node) do
local I/O in C++/libuv and never traverse the JS net prototype, so JS-level
instrumentation is structurally blind to native sockets. Therefore V2 claims
only "no egress from TeamBrain's JavaScript surface"; --strict is the OS-sandbox
tier for a stronger guarantee. Under-claim by construction (guardrail C6/§C).
Tradeoffs: V2 cannot make an unqualified "no egress" claim; stated explicitly
in the report allowlist and SECURITY.md rather than hidden.

## 2026-07-21 — E1 complete: tb verify V1–V8 + SECURITY.md
What: finished the self-audit command. V1 provenance (npm attestation for all 7
packages; offline→UNVERIFIED, shell:true so Windows .cmd works), V2 egress via
a child-process socket probe replaying a serve+search (0 JS-layer connections;
scoped to the JS surface per OQ-8), V4 redaction corpus vs the INSTALLED
redactor (corpus now shipped in @teambrain/redact files[]; shared loader), V5
digest people-free over the real spool, V7 retired-unserved on the live index.
SECURITY.md now points at the command and names the F8 embedding endpoint in an
explicit egress allowlist.
Why: turn privacy-by-construction from 500 internal tests into one command a
stranger runs on their own data (ADR-6). Under-claim everywhere.
Tradeoffs: V1 is registry-attestation-presence, not full sigstore-chain (stated
in the report). V2 cannot see native sockets (stated; --strict is the OS tier).
Evidence: `tb verify` PASS in 17s online / exit 2 UNVERIFIED offline; 8 checks,
each with a negative control; --json golden; 677 tests green; four-tool MCP
snapshot + egress-guard unchanged; CONTRACTS diff = amendment A only.

## 2026-07-21 — E2: FlightDeck v0 weekly report
What: `tb digest --format markdown|json --out <path>` (amendment D) renders the
weekly report from PRACTICE_SIGNALS strong-column signals only. Small-cell
suppression (n<5) lives in buildFlightDeckReport (the aggregator), not the
renderer, so a suppressed cell carries n but no value — --format json cannot
leak what markdown hides. Cursor unknown-inflation caveat inline; co-occurrence
labelled correlation; nothing reads plan_revision. Weekly CI template commits
the report under .teambrain/reports/ (CodeMap precedent, not PR-gated).
Why: makes the leadership-layer differentiator a durable, diffable artifact
from week one (ADR-9), without widening capture (PRACTICE_SIGNALS conditional
GO).
Tradeoffs: "Memories at risk" is a placeholder until E3 drift lands. Default
Slack behaviour unchanged. Reports never indexed (indexer scans memories/**
only; negative test asserts a reports/ file is unsearchable).
Evidence: 3-session fixture suppresses every derived cell + json has no
"value"; golden markdown body; not-indexed negative test; 680 tests green;
CONTRACTS diff = amendments A + D only. E2.4 (30-day dogfood) is a human task.
