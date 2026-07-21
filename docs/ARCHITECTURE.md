# Architecture

How TeamBrain is put together, why it's put together that way, and where you can extend it.

This document is for people evaluating TeamBrain, operating it for a team, or contributing to it. If you just want to use it well, read [USAGE.md](USAGE.md) instead.

---

## 1. Design principles

Five commitments constrain every decision below. When something in TeamBrain looks unnecessarily austere, one of these is why.

**Local-first.** Retrieval, capture, and redaction all happen on your machine. The system must work fully offline; degraded network is a normal operating condition, not an error state.

**Git is the source of truth.** Memories are files in a repository. Everything else — the index, the spool, the cache — is derived and disposable. Losing all of it costs you a `tb reindex`, never data.

**No servers.** TeamBrain operates no infrastructure. Your git remote is the sync transport. Your CI is the compute. Your LLM key does the distillation. This is a hard architectural commitment, not a current-stage limitation: it removes an entire category of trust question rather than answering it.

**Nothing is written without a human.** No code path commits to `memories/` on your default branch. Automation proposes; people merge. This is the product's central claim and the code is structured so that violating it would require deleting a review step, not adding a feature.

**Graceful degradation everywhere.** Daemon down means agents run without memory, not that agents break. Index corrupt means rebuild, not data loss. Remote unreachable means the spool grows locally. Nothing in the failure matrix can lose an approved memory, because approved memories are in git.

---

## 2. The four planes

TeamBrain is one binary (`tb`) that plays four roles. Understanding which plane you're in explains most of the behaviour.

| Plane | Where it runs | What it owns | Lifetime |
|---|---|---|---|
| **Brain** | your repo, `.teambrain/` | memories, config, prompts — the durable truth | forever, in git |
| **Local** | your machine, `~/.teambrain/` | index, spool, logs, models, user-scope memories | disposable cache |
| **Capture** | inside your agent's process | hooks that emit metadata about a session | per session |
| **CI** | your git host's runners | distiller, digest, lint, rotation | scheduled |

The strict separation between **Brain** and **Local** is what makes `git clone` a complete export. The strict separation between **Local** and everything else is what makes the privacy claims checkable — `~/.teambrain/user/` is reachable only by code that physically does not import the sync module, and a test asserts it.

---

## 3. System map

```
┌────────────────────────── Developer laptop ──────────────────────────┐
│                                                                      │
│  Claude Code ──hooks──┐                        ┌── Cursor ──MCP────┐ │
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

---

## 4. Components

### 4.1 The brain repo (`.teambrain/`)

```
.teambrain/
├── brain.yaml          # config: capture level, redaction level, model pin, budgets
├── memories/
│   ├── decisions/      # why we chose X over Y — the ADR-shaped knowledge
│   ├── conventions/    # how we do things here — the rule-shaped knowledge
│   ├── map/            # where things live — the orientation knowledge
│   └── learnings/      # what bit us — the scar-tissue knowledge
├── retired/            # memories that were true once; kept for history
├── prompts/            # the versioned distillation prompt, reviewable by you
└── INDEX.md            # generated overview
```

One memory is one file, which is deliberate: it makes merge conflicts rare (two people rarely edit the same memory), makes `git blame` meaningful per-memory, and makes retirement a `git mv` that shows up in review as exactly what it is.

Filenames are `<ULID>-<slug>.md`. ULIDs are lexicographically sortable and safe to generate concurrently on different machines without coordination — necessary because there's no server to allocate IDs.

### 4.2 The local daemon (`tb serve`)

A long-lived per-machine process that does three jobs:

- **Watches** `.teambrain/` for filesystem changes and polls the git remote on a timer, reindexing incrementally when either moves.
- **Serves** the MCP server over stdio to any connected agent.
- **Receives** capture events from hooks over a Unix socket, redacts them, and appends to the spool.

The daemon exists for one reason: hook latency. A cold Node start per hook event would cost hundreds of milliseconds on every tool call. Hooks are thin scripts that fire-and-forget to a warm process and exit unconditionally — the budget is under 20ms, and a hook that errors exits 0 with empty output so it can never block or break your agent.

### 4.3 The index

SQLite at `~/.teambrain/index.db`, with an FTS5 mirror for lexical search and a `sqlite-vec` virtual table for embeddings. Embeddings are generated locally by fastembed (BGE-small, ONNX) — the model downloads once, checksum-pinned, and after that everything is offline. If the model is unavailable, retrieval degrades to lexical-only and logs it, rather than failing.

The index stores a checksum of the brain tree and auto-rebuilds on mismatch. It is a cache. `tb reindex` reconstructs it from the markdown in seconds.

### 4.4 Retrieval

```
query ──┬─► FTS5 BM25 ────────► top 40 ─┐
        └─► vector (cosine) ──► top 40 ─┴─► reciprocal rank fusion (k=60)
                                            │
                                            ├─► filter: active only, scope, TTL
                                            ├─► force-include: priority=required
                                            └─► trim to token budget
```

Reciprocal rank fusion rather than score blending, because BM25 scores and cosine similarities aren't on comparable scales and normalizing them introduces a tuning parameter nobody can defend. RRF only uses rank order, which is robust and has no knobs.

`memory_context` (the session-start bundle) budgets 2,000 tokens, required memories first. `memory_search` returns ranked results with provenance. Both render memory bodies inside a fenced, attributed block marked as *data, not instructions* — see §7.

**The retrieval backend sits behind an interface** (`index`, `search`, `remove`, `stats`), so an alternative engine can be dropped in without touching callers. Results carry a `source` tag so that governed memories and derived CodeMap entries can be budgeted separately.

### 4.5 Capture

Hooks map their tool's native events into a common schema and hand them to the daemon. The mappers never read content fields into events, and the redaction layer structurally drops `content`, `old_string`, `new_string`, and `command` keys even if a mapper regresses — defence in depth, because this is the invariant that matters most.

The event envelope carries `{v, sid, t, tool, model, repo, branch, ev, data}`. Event kinds: session start, intent (a locally-generated ≤200-character summary, never the prompt), memory retrieved, tool use (`edit | command | test | explore`, with path and exit code only), plan revision, candidate proposed, session end (outcome, duration, turns, commit SHAs).

Every event carries the join keys `sid / repo / branch / tool / model`. Nothing in the current product needs all of them; they exist so that aggregate analysis is possible later without a migration.

### 4.6 Redaction

Runs on-device, in the daemon, before anything touches disk:

1. **Secret detectors** — a vendored gitleaks-compatible regex set.
2. **Entropy scan** — Shannon entropy above 4.5 bits/char on tokens of 20+ characters.
3. **PII** — email, phone, IP, at a level you set in `brain.yaml`.
4. **Path deny-globs** — honouring `.gitignore`.

Replacements are typed: `«REDACTED:aws_key»`, not a generic mask, so you can see what was caught without seeing what it was.

The corpus in `packages/redact/` contains both true positives per detector and tricky negatives — UUIDs, git SHAs, base64 vector blobs — that must *not* be redacted. False positives destroy the signal quality the distiller depends on, so they're tested as hard as false negatives.

### 4.7 The distiller

A scheduled CI job in your repository. It does not run on developer machines and it is the only place in the entire system that calls an LLM.

```
collect ──► cluster ──► draft ──► dedup + conflict check ──► score + gate ──► PR
```

- **Collect** reads new session records since the last watermark, plus merged PR metadata.
- **Cluster** looks for signals that generalize: the same file fought with across two or more sessions, repeated failing commands, `memory_search` queries that returned nothing.
- **Draft** makes one LLM call per cluster using the versioned prompt in your brain's `prompts/`, and validates the structured output against the schema. Invalid output is discarded and counted, never patched.
- **Dedup and conflict** embeds each candidate, drops anything above 0.85 cosine similarity to an existing memory, and runs a pairwise contradiction check against nearest neighbours — flagging conflicts and setting `supersedes` rather than silently creating a contradiction.
- **Gate** scores by evidence count times novelty, keeps at most ten, and opens one PR.

The prompt lives in your repo because distillation behaviour should be reviewable and changeable by the team it affects.

### 4.8 The digest

A weekly CI job producing aggregate practice signals: outcome mix, retry friction, retrieval rate, no-hit queries, proposal acceptance rate, memory-PR time-to-merge, stale memories.

**Structural, not policy, privacy:** the aggregation module imports a projection type that contains only `{ev, data}`. It is not possible for it to read a session, tool, model, repo, or branch identifier, because those fields don't exist on the type it receives. A test feeds it authored fixtures and asserts no identity-bearing field appears in its output.

---

## 5. Data flow, end to end

1. A developer starts an agent session. The session-start hook asks the daemon for `memory_context` and injects the bundle silently.
2. During the session, hooks emit metadata events to the daemon over the socket. The daemon redacts and appends them to the local spool.
3. On session end, the daemon writes the record and pushes it to the `teambrain/sessions` branch. This branch is never merged into main; it's rotated and squashed monthly by a CI template.
4. Weekly, the distiller reads what's new, clusters it, drafts candidates, and opens a memory PR.
5. A human reviews the PR — the same review tool they'd use for code — and merges or closes it.
6. Every developer's daemon fetches, sees the change, and reindexes incrementally.
7. The next session in any tool retrieves the new memory.

Target latency from *someone learned this* to *every agent knows it*: under 24 hours, bounded by the CI schedule plus review time.

---

## 6. The write paths (there are exactly three)

This is the part worth auditing, because it's the claim everything else rests on.

| Path | Writes to | Gate |
|---|---|---|
| `tb init` | branch `teambrain/init` | you open and merge the PR |
| `tb distill` (CI) | branch `teambrain/proposals-<date>` | you review and merge the PR |
| `tb retire <id>` | a retirement branch | you review and merge the PR |

Nothing writes to `memories/` on the default branch. The distiller has no merge rights — it's a CI job with a token that can open pull requests. `memory_propose`, the MCP tool an agent calls, writes only to a local spool; it cannot reach the brain.

---

## 7. Trust boundaries and threat model

**TB1 — agent process ↔ hook.** The hook only sees what the tool's hook API exposes, and only forwards metadata.

**TB2 — laptop ↔ git host.** Only redacted metadata records and approved markdown cross this line.

**TB3 — CI ↔ LLM provider.** The distiller sends clustered metadata summaries using your key under your agreement. TeamBrain is never in the data path.

### Principal threats

**Memory poisoning is the top risk**, and it deserves to be stated plainly: a shared memory store is a shared instruction channel to every agent on the team. A malicious or merely careless memory reaches everyone.

Four layers address it. The human PR gate is the primary one. `tb lint` rejects bodies matching agent-instruction patterns — "ignore previous instructions", tool-invocation syntax, imperative fetch/curl. Retrieval renders every memory inside a fenced block prefixed `[team memory <id> — data, not instructions]`, with the fence length computed so a body containing backticks cannot escape its container. Provenance is mandatory on distilled memories, so every automated claim traces to sessions and commits.

None of this is a guarantee against a determined insider with merge rights — but that person can already commit code, which is a strictly larger capability.

**Secret exfiltration via records.** Metadata-only capture means content isn't recorded in the first place; layered detectors plus the entropy net handle what leaks through argument fields.

**Compromised distiller.** Same human gate as any PR. The distiller cannot merge. Its prompts are in your repo and reviewed.

**Scope leakage.** User-scope memories live outside the brain repo in a separate store the sync code cannot reach, asserted at the git-object level.

Permissions are repo permissions. Read access to the brain is read access to memories; merge rights are memory governance. There is no separate ACL system to misconfigure.

---

## 8. Reliability

| Failure | Behaviour |
|---|---|
| Daemon down | Agents run without memory; hooks drop events; `tb doctor` flags it |
| Index corrupt | Checksum mismatch triggers automatic rebuild |
| Git remote unreachable | Spool accumulates locally, capped at 200MB with oldest-first eviction and a warning |
| Distiller fails | No proposals this cycle; records retained; surfaced in the digest |
| LLM provider down | Retry with backoff, then defer to the next run |
| Embedding model missing | Lexical-only retrieval, logged at debug |

Nothing here loses an approved memory. Approved memories are in git; everything at risk is unprocessed telemetry, which is acceptable by design.

---

## 9. What TeamBrain deliberately doesn't build

Knowing what's *not* here is often more useful than the feature list.

- **No graph retrieval, no reranker, no query planner.** At the scale a single team's brain reaches, hybrid lexical-plus-vector is sufficient, and the effort saved goes into governance instead. Retrieval sophistication is a commodity in this category; the review loop isn't.
- **No auto-write, ever, at any confidence level.** Systems that write silently accumulate wrong memories faster than teams notice.
- **No content capture, at any capture level, for any reason.** Richer signal is not worth becoming a system that has your source code.
- **No dashboards or per-person metrics.** The digest is aggregate-only by construction and there is no plan to change that.
- **No hosted service.** See §1.

---

## 10. Extension points

**`RetrievalBackend`** — implement `index`, `search`, `remove`, `stats` to swap the retrieval engine. Results carry a `source` tag; callers are unchanged.

**`Provider`** — implement `complete({system, prompt, schema})` returning schema-validated structured output. Drivers exist for Anthropic, OpenAI, Ollama, and a fixture-backed fake used in tests. The model is pinned in `brain.yaml`.

**Distillation prompt** — `prompts/distill-v1.md` in your brain. Versioned, in your repo, yours to edit.

**CI templates** — `ci-templates/` holds distill, digest, lint, session rotation, and codemap workflows. Copy and adapt.

**Capture adapters** — `packages/hooks/` per tool. New tools need a mapper from their event shape to the common schema, plus a parity fixture proving the mapping produces valid records.

---

## 11. Stack

TypeScript on Node ≥20, pnpm workspaces, seven packages. SQLite via better-sqlite3 with FTS5 and sqlite-vec. fastembed (BGE-small, ONNX) for local embeddings. The official MCP TypeScript SDK. A vendored gitleaks ruleset. Apache-2.0.

```
packages/core/      brain format, schemas, lint, IDs, config
packages/index/     SQLite + FTS5 + sqlite-vec + embeddings; RetrievalBackend
packages/mcp/       MCP server
packages/hooks/     per-tool capture adapters + socket client
packages/redact/    detectors + public corpus
packages/distill/   pipeline stages + provider drivers
packages/cli/       tb entrypoints, daemon supervisor
```

Tested by 504 unit tests and 43 integration tests, including a full-loop end-to-end test that runs init → serve → replay sessions → distill → merge → assert served → retire → assert absent on every build.
