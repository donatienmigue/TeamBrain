# TeamBrain V1 — Technical Architecture & Engineering Brief

**Version:** 1.0 · **Date:** July 2026 · **Status:** Proposed — for team review
**Audience:** founding engineering team. Assumes familiarity with the Product Brief (R1–R6) and Market Analysis (kill criteria, competitive posture).
**Scope:** V1 = the P0 requirement set (R1–R6): git-native brain, MCP server, Claude Code + Cursor capture, distillation-to-PR, memory lifecycle, weekly digest. FlightDeck analytics, cloud tier, and non-P0 adapters are **out of scope** but constrain interface design (noted inline).

> Reference only — `docs/CONTRACTS.md` wins on any conflict (per `README.md`).

---

## 1. Design Goals & Non-Negotiables

Derived from product principles; these are tie-breakers for every implementation decision.

1. **Local-first, zero-infra V1.** A team must get full value with no server we operate: the brain syncs through their existing git remote; distillation runs in their CI. We ship binaries, not a backend.
2. **Git is the source of truth.** Every durable artifact (memories, retirements, config) is a file in a repo. Everything else (indexes, caches, spools) is derived and rebuildable. `git clone` = full export.
3. **Graceful degradation everywhere.** If any TeamBrain component fails, the developer's agent session proceeds normally without memory. A hook must never block, slow (>50ms), or crash a session.
4. **Nothing leaves the machine un-redacted, and in V1 nothing leaves the machine at all** except git pushes of approved markdown and CI-run distillation (which reads the repo, not the developer's laptop).
5. **Human-approved writes only.** No process writes to the shared brain without a PR. Automation proposes; humans merge.
6. **Vendor-neutral by architecture.** All agent-facing behavior goes through MCP + per-tool thin hooks. No code path may be richer for one vendor by design.

### Non-functional requirements (V1 targets)

| Dimension | Target |
|---|---|
| Retrieval latency (MCP tool call, warm) | p50 < 80ms, p95 < 300ms |
| Session start context injection | < 500ms added to session start |
| Hook overhead per agent event | < 20ms p95 (async fire-and-forget) |
| Brain scale | 5,000 memories / repo, 50 devs / team without degradation |
| Distillation pipeline runtime | < 10 min/week of team sessions (CI job) |
| Index rebuild from cold repo | < 60s for 5,000 memories |
| Supported platforms | macOS (arm64/x64), Linux; Windows via WSL in V1 |
| Availability | N/A (no service); CLI/MCP must survive offline entirely |

---

## 2. System Overview

```
┌────────────────────────── Developer laptop ──────────────────────────┐
│                                                                      │
│  Claude Code ──hooks──┐                        ┌── Cursor ──hooks──┐ │
│        │              │                        │         │         │ │
│        │ MCP          ▼                        │ MCP     ▼         │ │
│        │        ┌──────────┐   append-only     │   ┌──────────┐    │ │
│        └───────►│          │◄──────────────────┘   │  Event   │    │ │
│                 │ teambrain│                        │  Spool   │    │ │
│                 │  daemon  │───────────────────────►│ (JSONL)  │    │ │
│                 │(MCP srv +│      redacted events   └────┬─────┘    │ │
│                 │ indexer) │                             │          │ │
│                 └────┬─────┘                             │          │ │
│                      │ reads                             │ git push │ │
│                      ▼                                   ▼ (sessions│ │
│               ┌────────────┐                     ┌──────────────┐   │ │
│               │ Local index│  derived from       │ .teambrain/  │   │ │
│               │ SQLite+vec │◄────────────────────│  brain repo  │   │ │
│               └────────────┘                     │  (markdown)  │   │ │
│                                                  └──────┬───────┘   │ │
└─────────────────────────────────────────────────────────┼───────────┘
                                                          │ git remote
                                                          ▼
                        ┌─────────────────── Team git host ───────────────────┐
                        │  brain repo (main) ◄── memory PRs ◄── humans approve │
                        │        ▲                                            │
                        │        │ opens PRs                                  │
                        │  ┌─────┴───────────┐    scheduled CI job            │
                        │  │ Distiller (CI)  │  reads session records +       │
                        │  │ + Digest job    │  merged diffs → proposals      │
                        │  └─────────────────┘                                │
                        └─────────────────────────────────────────────────────┘
```

**Data flow, end to end (the core loop):** agent session runs → hooks emit events → local redactor scrubs → events land in the local spool → spool syncs (as git objects on a dedicated branch, see §4.4) → weekly CI Distiller reads new session records + merged diffs → proposes candidate memories as a **memory PR** → human approves → merge to `main` → every developer's daemon pulls, reindexes → next session in any tool retrieves the new memory. Target learned-to-shared latency: < 24h (bounded by pipeline schedule + review time).

**Processes shipped:** one binary, `teambrain` (alias `tb`), which runs as (a) a CLI, (b) a lightweight per-machine daemon exposing the MCP server over stdio/socket and running the indexer/watcher, and (c) the distiller/digest entrypoint invoked by CI. One codebase, three entrypoints.

---

## 3. Key Architecture Decisions (condensed ADRs)

### ADR-1 — Storage: git-native markdown + derived SQLite index (Accepted)
**Options:** (A) database-backed service (MemNexus model); (B) git-native markdown as source of truth with a local derived index; (C) pure markdown with grep-only retrieval.
**Decision: B.** Markdown+YAML in a repo gives portability, PR-based governance for free, offline operation, and diffable history; a derived index (SQLite + FTS5 + `sqlite-vec`) gives fast hybrid retrieval. C fails relevance quality; A fails principles 1, 2, 4 and reproduces the competitor's weakness we position against.
**Consequences:** index is a cache — corruption is never data loss (`tb reindex` rebuilds); merge conflicts on memory files are rare (one memory = one file) and resolved by normal git workflow; we must own an ID scheme robust to concurrent creation (ULIDs).

### ADR-2 — Language & runtime: TypeScript on Node ≥ 20 (Accepted)
**Options:** (A) TypeScript; (B) Python; (C) Go/Rust.
**Decision: A.** The MCP reference SDK, Claude Code hook ecosystem, and Cursor extension surface are TS-first; npm is the distribution channel our exact ICP already uses (`npm i -g`); one language covers CLI, daemon, hooks, and CI distiller. Python (Cognee ecosystem) loses on single-binary distribution and hook latency; Go/Rust win on startup latency but slow us down and fragment the codebase. **Mitigation for cold-start:** daemon model — hooks talk to a warm process; distribute via `npm` + standalone builds (`bun build --compile`) for no-Node environments.

### ADR-3 — Retrieval backend: build minimal hybrid, behind an interface (Accepted)
**Options:** (A) embed Cognee (graph+vector engine); (B) build minimal hybrid retrieval (BM25 via FTS5 + local embeddings via fastembed/ONNX `bge-small`, reciprocal-rank fusion); (C) LLM-reranked retrieval.
**Decision: B**, behind a `RetrievalBackend` interface so a Cognee adapter can ship later without touching callers.
**Rationale:** at ≤5k memories/team, hybrid lexical+vector on SQLite comfortably beats the latency budget and avoids (i) a heavy dependency, (ii) coupling to a project that is itself an acquisition target (Market Analysis §8.5), (iii) an API-key requirement for *reads* — local ONNX embeddings keep retrieval fully offline. C is deferred to the eval harness (R10) as an optional reranker.

### ADR-4 — Team sync & compute: the customer's git host + CI, no TeamBrain servers (Accepted)
**Options:** (A) our hosted sync service; (B) git remote as transport, GitHub Actions/GitLab CI as compute for distillation/digest.
**Decision: B.** The brain repo *is* the sync mechanism; session records travel as git objects on a dedicated `teambrain/sessions` branch (never merged to main); the Distiller is a scheduled CI workflow using the team's own LLM API key (secret in CI). Zero infra for us, zero new trust surface for them, and self-hosting is the default rather than a promise. **Consequence:** Phase-2 cloud tier becomes "we run the CI job + add a UI," not a re-architecture. **Trade-off accepted:** session-record volume in git must be bounded — see §4.4 (rotation + squash policy).

### ADR-5 — LLM usage: distillation-only, provider-agnostic (Accepted)
LLM calls occur **only** in the CI Distiller (and never for retrieval). Provider interface with Anthropic/OpenAI/local (Ollama) drivers; model pinned in `brain.yaml`; all prompts versioned in-repo so distillation behavior is reviewable and reproducible.

---

## 4. Component Deep Dives

### 4.1 The Brain repo format (R1)

Lives either as a standalone repo or `.teambrain/` in the main repo (config choice at `tb init`).

```
.teambrain/
├── brain.yaml                 # config: scopes, required-tag rules, model pins, redaction level
├── memories/
│   ├── decisions/  01J8YAV2-jwt-migration.md
│   ├── conventions/01J8YB01-error-wrapping.md
│   ├── map/        01J8YB2K-payments-service.md
│   └── learnings/  01J8YB9X-s3-retry-gotcha.md
├── retired/                   # moved here by retirement PRs; kept for history & negative tests
├── prompts/                   # versioned distiller prompts (reviewable)
└── INDEX.md                   # generated human-readable table of contents (CI-maintained)
```

**Memory file = YAML front-matter + markdown body.** Front-matter schema (validated by `tb lint`, enforced in CI on every memory PR):

```yaml
id: 01J8YB9X3FQK7...        # ULID, generated at proposal time
class: learning              # decision | convention | map | learning
scope: team                  # team | org  (user-scope memories never enter this repo)
status: active               # active | retired (retired implies file lives under retired/)
priority: advisory           # required | advisory
title: "S3 client needs custom retry wrapper"
created: 2026-07-02
evidence:                    # provenance — mandatory for distilled memories
  sessions: ["s_01J8Y9...", "s_01J8YA..."]
  commits:  ["a1b2c3d"]
supersedes: []               # ids; conflict detection populates this
tags: [payments, aws]
ttl_days: null               # optional expiry for known-temporary facts
```

Body: ≤ 200 words of imperative, agent-consumable prose. `tb lint` rejects bodies containing instruction-injection patterns (see §6.3) and bodies > 400 words (context-budget discipline).

### 4.2 CLI surface (V1 complete list)

```
tb init            # scan repo; import CLAUDE.md/.cursorrules/AGENTS.md/ADRs; interview; emit initial brain as PR
tb serve           # run daemon (MCP server + indexer + watcher); installed into tool configs by `tb install`
tb install [tool]  # write MCP + hook config for claude-code | cursor (idempotent, diff-shown)
tb propose         # manually draft a memory from the last session (escape hatch before pipeline exists)
tb retire <id> "reason"   # open retirement PR (moves file to retired/, sets status)
tb audit [--last-session] # show exactly what was/would be recorded & transmitted, post-redaction
tb reindex         # rebuild SQLite index from repo (recovery path)
tb doctor          # env checks: tool versions, hook install state, index freshness, branch sync
tb distill         # CI entrypoint: run distiller over new session records → open memory PR
tb digest          # CI entrypoint: weekly team digest → Slack webhook / email
tb lint            # validate memory files (schema, size, injection patterns) — used as PR check
```

### 4.3 MCP server (R2)

Runs inside the daemon; registered in each tool via `tb install`. Exposed tools (kept deliberately few — every tool costs agent attention):

| MCP tool | Purpose | Notes |
|---|---|---|
| `memory_context()` | Session-start bundle: all `required` memories + top-k relevant to repo/branch/recent-files | Called by hook at session start; k=8 default, token-budgeted (≤ 2,000 tokens) |
| `memory_search(query, k)` | On-demand hybrid retrieval mid-session | Returns id, title, body, class, provenance |
| `memory_propose(draft)` | Agent suggests a candidate at session end | Writes to local spool as a *candidate*, never to the brain; surfaces in next distillation PR |
| `memory_feedback(id, useful)` | Optional usefulness signal | Feeds quality scoring & decay (R5) and, later, FlightDeck |

**Retrieval pipeline:** query → FTS5 (BM25) top-40 ∪ vector top-40 → reciprocal-rank fusion → filter (status=active, scope permitted, TTL valid) → `required` memories force-included → token-budget trim → response with attribution (`from team memory <id>: …`). Latency budget: FTS ≈ 5–10ms, vector scan over ≤5k rows ≈ 15–30ms, fusion+format ≈ 5ms — comfortably inside p95 300ms with cold-cache margin.

**Freshness:** daemon watches the brain repo (fs events) and runs `git fetch` on a 60s timer; merged memory PRs propagate to a teammate's next retrieval in ≤ 60s + pull. A retired memory disappears from results on the same cycle (negative test in CI, per R5 acceptance criteria).

### 4.4 Capture hooks & session records (R3)

**Claude Code:** native hooks — `SessionStart` (inject `memory_context()` result via additionalContext), `PostToolUse` (file edits, commands), `Stop`/`SessionEnd` (close record, trigger propose prompt). Hooks are a thin (<100-line) script that fire-and-forgets JSON to the daemon over a Unix socket; if the daemon is down, events drop silently (principle 3) and `tb doctor` reports it.

**Cursor:** hooks API where available (lifecycle + edit events); fallback for gaps is a rules-file directive instructing the agent to call `memory_context` at session start — degraded but functional. **This parity gap is the #1 technical risk (Open Question OQ-1)**; a 3-day timeboxed spike in Week 1 decides hook vs. proxy approach before we commit the event schema.

**Session record schema (JSONL, one event per line, one file per session):**

```json
{"v":1,"sid":"s_01J8Y9...","t":"2026-07-02T09:14:03Z","tool":"claude-code",
 "model":"claude-opus-4-8","repo":"acme/api","branch":"feat/webhooks",
 "ev":"tool_use","data":{"kind":"edit","path":"src/jobs/webhook.ts"}}
```

Event types (V1): `session_start`, `intent` (first user message → summarized locally, never raw), `memory_retrieved`, `tool_use` (edit/command/test, paths + exit codes only), `plan_revision`, `candidate_proposed`, `session_end` (outcome: committed | abandoned | unknown, duration, turn count). **Deliberately excluded in V1: raw prompts and raw diffs content** — we record *shape*, not content. This is both the privacy stance and 80% of what distillation needs; content-level capture is an opt-in flag (`capture.level: full`, default `metadata`) whose output never leaves the machine un-redacted.

**Design-ahead constraint (R12/FlightDeck):** every event carries the join keys `sid`, `repo`, `branch`, `tool`, `model`; `session_end` carries `commit_shas`. This is what lets Phase-3 FlightDeck join sessions ↔ PRs ↔ CI outcomes without a schema migration. Schema is versioned (`"v":1`) with an explicit compatibility policy: additive fields only within a major version.

**Transport & bounding:** completed, redacted session records are committed to the dedicated `teambrain/sessions` branch (never merged), pushed opportunistically. CI rotates the branch monthly (squash to a summary + delete raw records after distillation), keeping the git host burden bounded to ~10–50MB/month for a 20-dev team.

### 4.5 Redaction engine (R3)

Runs **in the hook path on-device**, before events touch the spool. Layered detectors: (1) secret patterns — API keys, JWTs, private keys, connection strings (gitleaks-compatible ruleset, vendored); (2) entropy scanner for unknown high-entropy tokens; (3) PII patterns — emails, phone numbers, IPs (configurable per `brain.yaml` redaction level); (4) path allowlist — events referencing paths matching `.gitignore` or `brain.yaml` deny-globs are dropped entirely. Replacement is typed (`«REDACTED:aws_key»`) so distillation retains signal without content. **The redaction test corpus is a public fixture in the OSS repo and a release gate:** no build ships with a corpus regression (this is the published test suite promised in R3 acceptance criteria). `tb audit` renders any session record exactly as stored — the trust feature, not an afterthought.

### 4.6 Distiller (R4) — the moat, engineered

CI-scheduled (default weekly; `tb distill` also runs ad hoc). Pipeline stages:

1. **Collect:** new session records since last run + merged PR metadata (titles, files, linked sessions via commit SHAs).
2. **Cluster:** group events by repeated signals — same file/subsystem struggled with across ≥2 sessions, repeated command failures, repeated `memory_search` queries with no hits (a *documentation-gap* gold signal), agent candidates from `memory_propose`.
3. **Draft:** one LLM call per cluster with a versioned prompt (in `prompts/`), producing a candidate in the exact front-matter schema, `evidence` populated from the cluster. Structured-output validated; invalid drafts are discarded, never "fixed" silently.
4. **Dedup & conflict:** embed candidate; cosine ≥ 0.85 vs existing memory → drop or propose as *amendment*; contradiction check (LLM pairwise vs top-3 nearest) → if conflict, candidate carries `supersedes:` and the PR body flags it prominently.
5. **Gate:** score candidates (evidence strength × novelty); emit at most N=10 per PR (reviewer-attention budget). Below-threshold candidates are held for the next cycle to accumulate evidence.
6. **Open the memory PR:** one branch, one file per candidate, PR body = human-readable table (title, class, evidence links, conflicts). `tb lint` runs as the PR check.

**Quality flywheel:** approval/rejection outcomes of past PRs are fed back as few-shot examples into the draft prompt (per-team calibration) — this is the mechanism behind the 30–60% acceptance-rate target (G4/leading metric), and it lives in the repo, so it's portable too.

### 4.7 Digest (R6)

Weekly CI job → Slack webhook (V1) / email (V1.1). Aggregate-only by construction: the digest generator has no code path that groups by author. Contents: memories proposed/approved/retired, top-retrieved, no-hit searches (doc gaps), drift check (hash-compare of tool-local rules files vs brain-generated exports), stale flags (90-day no-retrieval).

---

## 5. Security & Trust Architecture

**Trust boundaries:** (TB1) agent process ↔ hook: hook receives only what the tool's hook API exposes; (TB2) laptop ↔ git host: only redacted metadata records + approved markdown cross; (TB3) CI ↔ LLM provider: distiller sends clustered *metadata* summaries, using the team's own key under their DPA — we are never in the data path.

**Threat model highlights (STRIDE-lite, V1):**

| Threat | Vector | Mitigation |
|---|---|---|
| **Memory poisoning / prompt injection** (top risk) | Malicious or careless memory becomes instructions to every agent | PR review (human gate); `tb lint` injection heuristics (imperative-to-agent patterns like "ignore previous", tool-invocation strings, URLs with instructions); retrieval renders memories inside a fenced, attributed block the hook marks as *data, not instructions*; provenance mandatory |
| Secret exfiltration via records | Hook captures a secret before redaction misses it | Layered detectors + entropy net + public corpus gate; `capture.level: metadata` default means raw content isn't recorded at all |
| Compromised distiller PR | CI drafts a malicious memory | Same human gate as any code PR; distiller has no merge rights; prompts are in-repo and reviewed |
| Scope leakage | user-scope memory syncs to team | user scope lives outside the brain repo (`~/.teambrain/user/`), physically separate store; sync code cannot reach it |
| Supply chain | npm dependency compromise | minimal dep tree, lockfile + provenance (npm --provenance), signed releases |

**Permissions (V1):** repo permissions *are* the permission model — read brain = read memories; merge rights = memory governance. Org/multi-repo scoping and SSO arrive with the Phase-2 cloud tier (R8) and must not require format changes (scope field already present).

---

## 6. Reliability, Observability, Testing

**Failure matrix (graceful degradation, principle 3):** daemon down → agents run memory-less, hooks drop events, `tb doctor` flags; index corrupt → auto-`reindex` on checksum mismatch; git remote unreachable → spool accumulates locally (cap 200MB, oldest-first eviction with warning); CI distiller fails → no PR this cycle, records retained, alert in digest; LLM provider down → distiller retries with backoff, then defers. **Nothing in this matrix can lose approved memories** (they're in git) — only unprocessed telemetry, which is acceptable by design.

**Self-observability (local):** daemon exposes `tb doctor --json` (index freshness, last sync, hook heartbeat per tool, retrieval p95 over last 100 calls); structured logs to `~/.teambrain/logs/` with 7-day rotation. No phone-home in OSS builds — usage telemetry is opt-in and its schema is public.

**Testing strategy:** (1) redaction corpus — public, adversarial, release-gating; (2) retrieval evals (R10 seed) — golden query→memory fixtures per memory class, tracked recall@k in CI; (3) loop integration test — synthetic session records → distiller → assert PR shape, dedup, and conflict flags (golden-session fixtures); (4) negative tests — retired memory absent from all MCP tool outputs within one sync cycle; user-scope memory never present in any pushed object (asserted on the git object level); (5) hook latency benchmark in CI (<20ms p95 budget enforced).

---

## 7. Repo Layout & Stack Summary

```
teambrain/                     # monorepo (pnpm workspaces)
├── packages/core/             # brain format, lint, ids, config
├── packages/index/            # SQLite (better-sqlite3) + FTS5 + sqlite-vec + fastembed; RetrievalBackend iface
├── packages/mcp/              # MCP server (official TS SDK)
├── packages/hooks/            # claude-code/, cursor/ thin adapters + socket client
├── packages/redact/           # detectors + public corpus
├── packages/distill/          # pipeline stages + provider drivers (anthropic|openai|ollama)
├── packages/cli/              # tb entrypoints (commander), daemon supervisor
├── ci-templates/              # GitHub Action + GitLab CI templates for distill/digest/lint
└── docs/                      # this brief, format spec, threat model, runbooks
```

Stack: TypeScript / Node ≥20 (standalone builds via bun compile) · SQLite + FTS5 + sqlite-vec · fastembed (bge-small, ONNX, local) · official MCP TS SDK · gitleaks ruleset (vendored) · Apache-2.0.

## 8. Milestones (maps to Product Brief Phase 0/1)

**Week 1 — spikes (timeboxed, decide-and-move):** OQ-1 Cursor hook parity (3d); local-embedding latency on target hardware (1d); Claude Code additionalContext injection limits (1d). *Exit: event schema frozen at v1.*
**Weeks 2–3 — E1 Brain + CLI:** format, lint, `init` importer + interview, ULIDs. *Exit: our own repo has a brain via `tb init`.*
**Weeks 3–4 — E2 Index + MCP:** hybrid retrieval, `memory_context`/`memory_search`, freshness watcher. *Exit: Claude Code session visibly loads team memories, p95 < 300ms.*
**Weeks 4–5 — E3 Capture + Redaction:** Claude Code hooks, spool, sessions branch, `tb audit`, public corpus. *Exit: full session recorded, audit-clean.*
**Weeks 5–6 — E4 Distiller MVP + dogfood:** manual `tb distill`, memory PR, dedup v1. *Exit gate (Phase 0): 5 design-partner teams incl. us, daily unprompted use, first distilled memory approved by someone who didn't write the code it came from.*
**Weeks 6–16 — Phase 1:** Cursor hook (per spike outcome), CI templates, conflict detection, digest, feedback flywheel, docs + OSS launch. *Exit gates: distillation acceptance ≥ 30%; retired-memory negative test green in CI; 100-WAT trajectory.*

## 9. Open Technical Questions

**OQ-1 (blocking, Week-1 spike):** Cursor lifecycle-hook parity — native hooks vs. MCP-side inference of session boundaries vs. rules-directive fallback. Decides event-schema fidelity per tool.
**OQ-2 (blocking):** Claude Code context-injection ceiling — how many tokens can `SessionStart` inject before degrading agent behavior? Sets the `memory_context` budget (working number: 2,000 tokens).
**OQ-3:** distillation on GitLab CI + Bitbucket parity — templates or docs-only at launch?
**OQ-4:** amendment UX — when dedup finds near-duplicates, propose an edit-PR to the existing file vs. a superseding memory? (Leaning edit-PR; needs design-partner feedback.)
**OQ-5:** signed memories — do we need commit-signing enforcement on the brain repo for regulated design partners in V1, or defer to Phase 2 with the compliance module?
