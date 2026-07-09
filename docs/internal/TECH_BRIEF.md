# TeamBrain V1 — Technical Architecture & Engineering Brief

**Version:** 2.0 · **Date:** July 2026 · **Status:** Proposed — for team review (aligned to Product Brief v2.0 repositioning)
**Audience:** founding engineering team. Assumes familiarity with the Product Brief v2.0 (governance + FlightDeck as differentiators; memory as commoditized on-ramp) and Market Analysis (competitive scan §8.6–8.13, kill criteria).
**Scope:** V1 = the P0 requirement set (R1–R6): git-native brain, MCP server, Claude Code + Cursor capture, distillation-to-PR, memory lifecycle, weekly digest. FlightDeck analytics, cloud tier, non-P0 adapters, and **CodeMap (R16, codebase memory — fully specified in §4.8 but V1.1, not V1)** are **out of scope to build** — but three of them (FlightDeck's data model, CodeMap's index `source` dimension, and its provenance keys) impose **P0 obligations on the V1 data schema** because they cannot be retrofitted. These are called out as design-ahead constraints inline.

> **v2.0 note.** The architecture below already embodies the product repositioning — git-native storage *is* the governance differentiator, and metadata-first capture *is* the trust differentiator — so little changed structurally. What changed: (1) the distiller is reframed as "the governance gate," not "the moat"; (2) FlightDeck's join-key requirements are promoted from "architectural insurance" to hard P0 acceptance criteria; (3) a new open question surfaces the privacy↔FlightDeck tension the Product Brief flagged; (4) an explicit "commodity parity, not victory" framing bounds effort on retrieval. The competitive reality (Agent Memory, Mori, et al. ship the same capture+retrieval stack) means our engineering edge is governance ergonomics and the telemetry data model — not retrieval sophistication.

> Reference only — `docs/internal/CONTRACTS.md` wins on any conflict (per `CONTRIBUTING.md`).

---

## 1. Design Goals & Non-Negotiables

Derived from product principles; these are tie-breakers for every implementation decision.

1. **Local-first, zero-infra V1.** A team must get full value with no server we operate: the brain syncs through their existing git remote; distillation runs in their CI. We ship binaries, not a backend.
2. **Git is the source of truth.** Every durable artifact (memories, retirements, config) is a file in a repo. Everything else (indexes, caches, spools) is derived and rebuildable. `git clone` = full export.
3. **Graceful degradation everywhere.** If any TeamBrain component fails, the developer's agent session proceeds normally without memory. A hook must never block, slow (>50ms), or crash a session.
4. **Nothing leaves the machine un-redacted, and in V1 nothing leaves the machine at all** except git pushes of approved markdown and CI-run distillation (which reads the repo, not the developer's laptop).
5. **Human-approved writes only.** No process writes to the shared brain without a PR. Automation proposes; humans merge. *This is the governance differentiator — the sharpest line between us and every silent-capture competitor (Agent Memory, MemNexus, Unblocked). It is non-negotiable even when a silent write would be more convenient.*
6. **Vendor-neutral by architecture.** All agent-facing behavior goes through MCP + per-tool thin hooks. No code path may be richer for one vendor by design.
7. **The telemetry data model is a P0 asset, not a byproduct.** FlightDeck (the primary product differentiator, built later) is only possible if V1's session events carry the right join keys from day one. Every event MUST carry `sid/repo/branch/tool/model`; `session_end` MUST carry `commit_shas`. This is a hard V1 requirement even though no analytics ship in V1 — the schema cannot be retrofitted onto historical data.
8. **Commodity parity, not commodity victory.** Retrieval quality, adapter breadth, and graph sophistication are table stakes — match the OSS incumbents (Agent Memory ships BM25+vector+graph RRF; we ship BM25+vector RRF, sufficient at our scale) and stop. Do not spend engineering optimizing recall@k as a headline; spend it on governance ergonomics and the data model. If a design choice trades retrieval-benchmark bragging rights for simpler governance, take the simpler governance.

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

### ADR-1 — Storage: git-native markdown + derived SQLite index (Accepted) — *the core differentiator*
**Options:** (A) database-backed service (MemNexus/Agent Memory model — silent auto-write to a local/cloud DB); (B) git-native markdown as source of truth with a local derived index; (C) pure markdown with grep-only retrieval; (D) database + bespoke review UI + intake service (the Mori model — governance, but not git-native).
**Decision: B.** This is not merely a technical choice; it is *the* product differentiator expressed in architecture. Markdown+YAML in a repo gives portability (`git clone` = export), PR-based governance for free (approval is a code review, not a bespoke UI), offline operation, and diffable history; a derived index (SQLite + FTS5 + `sqlite-vec`) gives fast hybrid retrieval. **Why B beats D (the closest competitor, Mori):** Mori achieves governance with a Postgres intake service, a Trusted-Dreamer review UI, and a promotion finalizer — real, but heavy to run and foreign to developers. We get the same governance from `git` + the review tools the team already uses, with no servers. The trust model ("your AI's memory is a file you review in a PR") is native to the ICP in a way a database + review app is not. C fails relevance quality; A reproduces exactly the silent-write weakness we position against.
**Consequences:** index is a cache — corruption is never data loss (`tb reindex` rebuilds); merge conflicts on memory files are rare (one memory = one file) and resolved by normal git workflow; we must own an ID scheme robust to concurrent creation (ULIDs). The cost of git-native (no server-side query power, sync latency bounded by `git fetch`) is accepted precisely because it buys the differentiator.

### ADR-2 — Language & runtime: TypeScript on Node ≥ 20 (Accepted)
**Options:** (A) TypeScript; (B) Python; (C) Go/Rust.
**Decision: A.** The MCP reference SDK, Claude Code hook ecosystem, and Cursor extension surface are TS-first; npm is the distribution channel our exact ICP already uses (`npm i -g`); one language covers CLI, daemon, hooks, and CI distiller. Python (Cognee ecosystem) loses on single-binary distribution and hook latency; Go/Rust win on startup latency but slow us down and fragment the codebase. **Mitigation for cold-start:** daemon model — hooks talk to a warm process; distribute via `npm` + standalone builds (`bun build --compile`) for no-Node environments.

### ADR-3 — Retrieval backend: build minimal hybrid, behind an interface (Accepted)
**Options:** (A) embed Cognee (graph+vector engine); (B) build minimal hybrid retrieval (BM25 via FTS5 + local embeddings via fastembed/ONNX `bge-small`, reciprocal-rank fusion); (C) LLM-reranked retrieval.
**Decision: B**, behind a `RetrievalBackend` interface so a Cognee/Mem0 adapter can ship later without touching callers.
**Rationale:** at ≤5k memories/team, hybrid lexical+vector on SQLite comfortably beats the latency budget and avoids (i) a heavy dependency, (ii) coupling to a project that is itself an acquisition target (Market Analysis §8.13), (iii) an API-key requirement for *reads* — local ONNX embeddings keep retrieval fully offline. Per design goal 8 (commodity parity, not victory), we deliberately ship *less* than Agent Memory's triple-stream graph retrieval — BM25+vector RRF is sufficient at our scale, and the saved effort goes to governance and the data model. C (LLM rerank) is deferred to the eval harness (R10) as an optional reranker.
**Design-ahead #1 (R16 CodeMap, P1):** the `RetrievalBackend` must support multiple *sources* — `index(docs, source: 'memory' | 'codemap')`, and search results carry `source` so `memory_context` budgets the two pools separately and applies per-source ranking. Governed memories go through PR; CodeMap entries are derived artifacts and are indexed directly (governance applies to knowledge, not maps). One-field cost in V1 (M3.1 schema + C4); build nothing else for CodeMap now.
**Design-ahead #2 (FlightDeck data model, now P0 not insurance):** retrieval and index code must preserve, not discard, the session-provenance join keys on every indexed item and every query-log entry (`sid/repo/branch/tool/model`). FlightDeck's practice-mining joins sessions↔memories↔retrievals↔outcomes; if the index layer drops these on ingest, the analytics product is impossible without a migration. Assert their presence in M3 tests.

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
| `memory_context()` | Session-start bundle: all `required` memories + top-k relevant to repo/branch/recent-files | Called by hook at session start; k=8 default, token-budgeted (≤ 2,000 tokens). *V1.1: also returns a budgeted CodeMap slice (§4.8) via the `source` dimension — no signature change.* |
| `memory_search(query, k)` | On-demand hybrid retrieval mid-session | Returns id, title, body, class, provenance, `source`. *Searches governed memories in V1; transparently also searches CodeMap in V1.1 — same tool, results tagged by source.* |
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

**Design-ahead constraint (R12/FlightDeck — P0, not deferrable):** every event carries the join keys `sid`, `repo`, `branch`, `tool`, `model`; `session_end` carries `commit_shas`. Per the v2.0 repositioning, FlightDeck is the primary product differentiator, and it is *only buildable* if this data model is correct from the first session — historical telemetry cannot be re-keyed. Therefore these keys are P0 acceptance criteria in M5, tested explicitly (an event missing a join key fails validation), even though no analytics ship in V1. Schema is versioned (`"v":1`) with additive-only evolution within a major version. Treat the event schema as a published contract the moment the OSS launches — breaking it later breaks FlightDeck.

**Privacy ↔ FlightDeck tension (flagged, resolution required before FlightDeck build — see OQ-6):** V1 captures metadata only (shape, not content). FlightDeck's richest analyses (prompt quality, plan quality, why the best users are effective) may want signal that lives closer to content. The metadata-first privacy principle is non-negotiable, so FlightDeck must be designed to extract practice insight from metadata + outcomes (retry counts, plan revisions, review depth, rework) rather than prompt content. V1's job is to prove enough signal exists in metadata; if it does not, that is a strategic finding, not a reason to weaken the privacy stance.

**Transport & bounding:** completed, redacted session records are committed to the dedicated `teambrain/sessions` branch (never merged), pushed opportunistically. CI rotates the branch monthly (squash to a summary + delete raw records after distillation), keeping the git host burden bounded to ~10–50MB/month for a 20-dev team.

### 4.5 Redaction engine (R3)

Runs **in the hook path on-device**, before events touch the spool. Layered detectors: (1) secret patterns — API keys, JWTs, private keys, connection strings (gitleaks-compatible ruleset, vendored); (2) entropy scanner for unknown high-entropy tokens; (3) PII patterns — emails, phone numbers, IPs (configurable per `brain.yaml` redaction level); (4) path allowlist — events referencing paths matching `.gitignore` or `brain.yaml` deny-globs are dropped entirely. Replacement is typed (`«REDACTED:aws_key»`) so distillation retains signal without content. **The redaction test corpus is a public fixture in the OSS repo and a release gate:** no build ships with a corpus regression (this is the published test suite promised in R3 acceptance criteria). `tb audit` renders any session record exactly as stored — the trust feature, not an afterthought.

### 4.6 Distiller (R4) — the governance gate, engineered

The distiller's differentiating property is not that it distills (every competitor does) but that its output is a *proposal to humans*, never a write. The value is the PR gate; the pipeline exists to feed it high-signal candidates. CI-scheduled (default weekly; `tb distill` also runs ad hoc). Pipeline stages:

1. **Collect:** new session records since last run + merged PR metadata (titles, files, linked sessions via commit SHAs).
2. **Cluster:** group events by repeated signals — same file/subsystem struggled with across ≥2 sessions, repeated command failures, repeated `memory_search` queries with no hits (a *documentation-gap* gold signal), agent candidates from `memory_propose`.
3. **Draft:** one LLM call per cluster with a versioned prompt (in `prompts/`), producing a candidate in the exact front-matter schema, `evidence` populated from the cluster. Structured-output validated; invalid drafts are discarded, never "fixed" silently.
4. **Dedup & conflict:** embed candidate; cosine ≥ 0.85 vs existing memory → drop or propose as *amendment*; contradiction check (LLM pairwise vs top-3 nearest) → if conflict, candidate carries `supersedes:` and the PR body flags it prominently.
5. **Gate:** score candidates (evidence strength × novelty); emit at most N=10 per PR (reviewer-attention budget). Below-threshold candidates are held for the next cycle to accumulate evidence.
6. **Open the memory PR:** one branch, one file per candidate, PR body = human-readable table (title, class, evidence links, conflicts). `tb lint` runs as the PR check.

**Quality flywheel:** approval/rejection outcomes of past PRs are fed back as few-shot examples into the draft prompt (per-team calibration) — this is the mechanism behind the 30–60% acceptance-rate target (leading metric), and it lives in the repo, so it's portable too. **Governance-friction target (product G2):** the whole point is that approving a memory is fast — the PR body must let a reviewer approve in under a minute (median review time <10 min is a product goal). If the gate is slow, teams disable it and we lose the differentiator; PR-body ergonomics are therefore a first-class engineering concern, not cosmetic (see OQ-4).

### 4.7 Digest (R6)

Weekly CI job → Slack webhook (V1) / email (V1.1). Aggregate-only by construction: the digest generator has no code path that groups by author. Contents: memories proposed/approved/retired, top-retrieved, no-hit searches (doc gaps), drift check (hash-compare of tool-local rules files vs brain-generated exports), stale flags (90-day no-retrieval).

### 4.8 CodeMap (R16) — codebase memory so agents stop re-reading the repo

**Status: fully specified, V1.1 build (NOT in the V1 P0 set).** The design-ahead in ADR-3 (`source` dimension) exists precisely so this ships without an interface break or contract change. Specified here in full so it is build-ready the moment V1 lands; deliberately fenced out of V1 for the reasons in the scope note below.

**Problem it solves.** A stateless agent starting a new session re-explores the codebase from scratch — grepping, opening files, tracing call paths — to answer "where does X live / what calls Y / how is Z wired?" A teammate's agent did the same exploration this morning; a model or tool switch resets it to zero. This re-exploration is a large share of agentic token spend (re-sent/re-explored context ≈ 50–62% of the bill) and it degrades output as the context window fills. CodeMap makes the codebase *pre-explored and shared*: the agent asks a question and gets a ~200-token answer instead of a 40K-token exploration.

**What it is.** A second class of indexed content — machine-generated, not human-authored — served through the *same* MCP tools the agent already uses. Per-module and per-file summaries plus a symbol/relationship map: what each module does, its public entry points, key types, cross-module dependencies, and "where X lives" answers. It is a derived artifact (regenerable from source at any commit), so it is **indexed directly, not PR-approved** — the governance gate applies to *human knowledge* (decisions, conventions, learnings), not to a mechanical map of code that already exists in the repo. This distinction is a feature: it keeps the review queue focused on judgment, not machine output.

**How it stays fresh — incremental, in CI (the part that makes it cheap).**
1. A CI job on merge to the default branch diffs changed files against a stored per-file content-hash manifest (Merkle-style — the pattern proven by the OSS ecosystem and by Agent Memory/Cognee).
2. Only changed files are re-summarized (one cheap LLM call per changed file/module, batched); unchanged files reuse their existing summary. A 500k-LOC repo with a 20-file PR reprocesses 20 files, not 500k — target <2 min incremental update.
3. Summaries are written to a dedicated `.teambrain/codemap/` tree (still git-native and diffable — you can *read the map in a PR* even though it isn't gated) and indexed with `source: 'codemap'`.
4. Nothing is served stale beyond one merge cycle (CI-tested, mirroring the retired-memory negative test).

**How the agent consumes it — zero new agent-facing surface (design goal, non-negotiable).** CodeMap reuses the existing MCP tools:
- `memory_context()` at session start now returns a small budgeted CodeMap slice for the current repo/branch/recent-files (e.g. summaries of the modules the session is likely to touch) *alongside* required memories — so the agent begins already oriented.
- `memory_search(query)` transparently searches both sources; results carry `source: 'memory' | 'codemap'` so the agent (and the token budget) can distinguish governed knowledge from a code map. Separate per-source budgets prevent CodeMap from crowding out governed memories: e.g. 2,000 tokens memories + 1,500 tokens CodeMap, tuned via OQ-2 findings.
If CodeMap ever needs a *new* MCP tool, the design is wrong — the whole point is that the agent already knows how to ask.

**Build-vs-buy (the real decision, informed by V1 dogfooding — OQ-6).** The incremental-summarize-and-index pipeline is exactly what Cognee and Mem0 already do well (code graphs, incremental ingestion, MCP-native). CodeMap is therefore the strongest candidate in the whole system for *embedding an existing engine behind the `RetrievalBackend` interface* rather than building. V1 ships the interface and the `source` seam; V1.1 decides build-our-own-summarizer vs. embed-Cognee using real data on retrieval quality and cost from dogfooding. This is why it is not in V1: the buy option is cheaper and the decision is better made with evidence.

**Privacy note.** CodeMap summarizes *the team's own source code that already lives in the repo* — no new privacy surface, unlike session capture. In self-host mode the summarizer uses the team's own LLM key (or local model); code never leaves their infrastructure, same as the distiller.

**Acceptance criteria (V1.1):** ≥30% reduction in exploration tokens per session on instrumented pilot teams (measured via the `tool_use` event stream — grep/read events per session before vs. after); incremental CI update <2 min on a 500k-LOC repo; CodeMap answers for a changed file reflect the change within one merge cycle (negative test); zero new MCP tools added; governed memories never crowded out of `memory_context` by CodeMap (budget-isolation test).

> **Scope fence.** CodeMap is specified, not scheduled into V1. Pulling it forward would (a) consume the engineering the primary bet (FlightDeck validation) needs, (b) pre-empt a build-vs-buy decision that is cheaper and better after dogfooding, and (c) add index complexity before the core governance loop is proven. The `source` design-ahead guarantees deferring it costs no rework. Build it in V1.1, immediately after the V1 governance loop is validated — this is the top of the post-V1 backlog, not a "someday."

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
**Weeks 3–4 — E2 Index + MCP:** hybrid retrieval, `memory_context`/`memory_search`, freshness watcher, `source` dimension in schema (design-ahead #1). *Exit: Claude Code session visibly loads team memories, p95 < 300ms; index preserves session-provenance join keys (design-ahead #2, asserted in test).*
**Weeks 4–5 — E3 Capture + Redaction:** Claude Code hooks, spool, sessions branch, `tb audit`, public corpus. *Exit: full session recorded, audit-clean; every event carries `sid/repo/branch/tool/model` and `session_end` carries `commit_shas` (FlightDeck P0 data-model test green).*
**Weeks 5–6 — E4 Distiller MVP + dogfood:** manual `tb distill`, memory PR, dedup v1. *Exit gate (Phase 0): 5 design-partner teams incl. us, daily unprompted use, memory-PR flow used not bypassed, first distilled memory approved by someone who didn't write the code it came from.*
**Weeks 6–16 — Phase 1:** Cursor hook (per spike outcome), CI templates, conflict detection, digest, feedback flywheel, docs + OSS launch. *Exit gates: distillation acceptance ≥ 30%; median memory-PR review time <10 min (governance-friction, product G2); retired-memory negative test green in CI; 100-WAT trajectory; **FlightDeck willingness-to-pay interviews started with ≥3 design partners (product G3) — validate the primary bet now, not in Phase 3.***

## 9. Open Technical Questions

**OQ-1 (blocking, Week-1 spike):** Cursor lifecycle-hook parity — native hooks vs. MCP-side inference of session boundaries vs. rules-directive fallback. Decides event-schema fidelity per tool.
**OQ-2 (blocking):** Claude Code context-injection ceiling — how many tokens can `SessionStart` inject before degrading agent behavior? Sets the `memory_context` budget (working number: 2,000 tokens).
**OQ-3:** distillation on GitLab CI + Bitbucket parity — templates or docs-only at launch?
**OQ-4:** amendment UX — when dedup finds near-duplicates, propose an edit-PR to the existing file vs. a superseding memory? (Leaning edit-PR; needs design-partner feedback.)
**OQ-5:** signed memories — do we need commit-signing enforcement on the brain repo for regulated design partners in V1, or defer to Phase 2 with the compliance module?
**OQ-6 (P1 design, decide before M3 freeze):** CodeMap source dimension — is a `source: memory|codemap` column + per-source weights in the V1 index schema sufficient design-ahead, and does the CodeMap generator justify embedding Cognee's/Mem0's code-graph pipeline versus extending our own summarizer?
**OQ-7 (strategic, validate during V1 dogfood — gates the primary bet):** Can FlightDeck's core insights (which practices ship better code; what distinguishes the most effective AI users) be derived from **metadata + outcomes alone** (retries, plan revisions, review depth, rework, no-hit queries), without prompt/diff content? The metadata-first privacy principle is fixed, so this is the load-bearing question for the whole FlightDeck thesis. V1 must instrument enough to answer it empirically before Phase-3 build commitment. If the answer is "no," that is a company-level strategic finding surfaced early — by design — not a licence to weaken privacy.
