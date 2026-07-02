# TeamBrain V1 — Build Plan

Conventions: every task lists **Deliverables**, **Notes**, and **Accept** (commands that must pass). Do tasks in order; do not start a task with a prior task's Accept red.

### M0 — Scaffold (½ day)
**M0.1 Monorepo skeleton.** Deliverables: pnpm workspace with `packages/{core,index,mcp,hooks,redact,distill,cli}`, shared tsconfig (strict, ESM, NodeNext), vitest, eslint+prettier, `pnpm build|test|lint|bench` wired, GitHub Actions CI running all four on Node 20/22, empty `docs/DEVLOG.md`.
Accept: `pnpm build && pnpm test && pnpm lint` green in CI on both Node versions.

### M1 — packages/core: brain format (1–2 days)
**M1.1 Schemas & IDs.** zod schemas for Memory front-matter (C1), brain.yaml config, session events (C2); ULID generation; slug util; markdown+front-matter parse/serialize with byte-exact round-trip.
Accept: `pnpm --filter core test` — includes round-trip property test over fixture corpus `testdata/memories/*` (create ≥12 fixtures covering all classes, retired, TTL, supersedes).
**M1.2 `tb lint`.** Validates schema, body ≤400 words, title ≤80, evidence presence for distilled memories, and **injection heuristics**: reject bodies matching agent-instruction patterns (case-insensitive: "ignore (all )?previous", "disregard .*(instruction|rule)", "you must now", tool-invocation syntax like `mcp__`, raw `<system>`-style tags, "fetch|curl http" imperatives). Heuristics table lives in `packages/core/src/injection-patterns.ts` with one test per pattern + negative tests (legit bodies mentioning e.g. "the previous migration" must pass).
Accept: `tb lint testdata/brains/valid` exits 0; `tb lint testdata/brains/poisoned` exits 3 listing each violation.
**M1.3 Logger + errors.** Structured logger (debug|info|warn|error) writing to `~/.teambrain/logs/` with 7-day rotation; typed error hierarchy mapping to CLI exit codes (C6). Guardrail: logger redacts fields named body|content|prompt at info+.

### M2 — `tb init` importer (2 days)
**M2.1 Scanner+importer.** Detect and parse CLAUDE.md, .cursorrules, .cursor/rules/*, AGENTS.md, docs/adr/*; convert each into candidate memories (class inferred: ADR→decision, rules→convention, README arch sections→map) preserving ≥90% of source text into bodies (split >400 words into linked memories).
**M2.2 Interview.** ≤10 generated questions from gaps (no map memories? ask for service list; conflicting rules? ask which wins). Plain readline; every question skippable.
**M2.3 Output as PR-ready branch.** Writes `.teambrain/`, commits on branch `teambrain/init`, prints next-step instructions; never touches main.
Accept: integration test — run against 3 fixture repos (`testdata/repos/{claude-md-only,cursor-heavy,adr-rich}`); assert memory counts, class mapping, and ≥90% text preservation (Jaccard token overlap assertion); `git status` on fixture main is clean.

### M3 — packages/index: retrieval (2–3 days)
**M3.1 Store & schema.** better-sqlite3 db at `~/.teambrain/index.db`: memories table, FTS5 mirror, vec0 virtual table (sqlite-vec) for embeddings; checksum of brain tree stored; auto-reindex on mismatch.
**M3.2 Embeddings.** fastembed bge-small, lazy model download to `~/.teambrain/models/` with checksum pin; embed on index, batch 64. Offline guard: if model absent and download impossible, degrade to lexical-only with a debug log (principle 2).
**M3.3 Hybrid search (C4).** BM25 top-40 ∪ vector top-40 → RRF(k=60) → filters → required force-include → token-budget trim (est. 4 chars/token).
**M3.4 Bench.** Generator for a synthetic 5k-memory brain; `pnpm bench` asserts search p95 < 300ms and index rebuild < 60s on CI hardware; recall@8 ≥ 0.85 on the golden query set `testdata/golden-queries.yaml` (write 25 query→expected-id pairs).
Accept: `pnpm --filter index test && pnpm bench` green.

### M4 — packages/mcp + daemon (2–3 days)
**M4.1 Daemon.** `tb serve`: long-lived process; watches `.teambrain/` (fs events) + `git fetch` timer (60s) on the brain; incremental reindex on change; unix socket at `~/.teambrain/daemon.sock` for hook events; pidfile + `tb doctor` heartbeat.
**M4.2 MCP server (C3).** stdio MCP server via official SDK exposing the 4 tools; memory rendering per C3 injection-mitigation rule; `memory_context` respects the 2000-token budget with required-first ordering.
**M4.3 `tb install claude-code`.** Idempotently writes MCP registration and hook config into project `.claude/settings.json` (show diff, ask confirm; `--yes` for CI). Registers a `SessionStart` hook that calls the daemon and emits `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<memory_context bundle>"}}` on stdout (≤10k chars — trim to budget), and never blocks: on any error, exit 0 with empty output.
Accept: integration test with a scripted MCP client — call all 4 tools against a fixture brain; retire a memory on a branch, merge, assert it disappears from `memory_search` within one watcher cycle (**the R5 negative test**); `tb install` run twice produces zero diff the second time.

### M5 — packages/hooks + packages/redact: capture (3 days)
**M5.1 Redaction engine.** Detectors: vendored gitleaks-compatible regex set; Shannon-entropy scanner (>4.5 bits/char on tokens ≥20 chars); PII (email/phone/IP) per `brain.yaml` redaction level; deny-glob path filter honoring .gitignore. Typed replacements `«REDACTED:type»`. Public corpus at `packages/redact/corpus/` (≥120 cases: true positives per detector, tricky negatives like UUIDs and git SHAs which must NOT redact). Corpus is a release gate: CI fails on any regression.
**M5.2 Claude Code hook set.** Thin scripts (no deps beyond node) for SessionStart (context inject, M4.3), PostToolUse (map tool_name/tool_input → C2 tool_use events; capture paths and exit codes only — never content fields), Stop/SessionEnd (close record: outcome heuristic = commits made during session; emit candidate prompt "2 candidate memories — propose? [y/N]" only if candidates exist). All hooks: read stdin JSON → ≤20ms handling → fire-and-forget to daemon socket → exit 0 unconditionally. Use `"async": true` in hook config where supported.
**M5.3 Spool + sessions branch.** Daemon persists redacted events to `~/.teambrain/spool/<sid>.jsonl`; on session_end, commit the record to local branch `teambrain/sessions` and push opportunistically (failure = keep local, cap spool at 200MB oldest-first with warn log).
**M5.4 `tb audit`.** Pretty-print last session's record exactly as stored, with a redaction summary line ("3 replacements: 2 aws_key, 1 email").
Accept: `pnpm --filter redact test` (corpus green); end-to-end test: replay a recorded fixture session (`testdata/sessions/raw-claude.jsonl`) through the hook handlers → assert produced JSONL validates against C2, contains zero un-redacted corpus strings, and hook handler bench < 20ms p95; assert no event ever contains keys named content|old_string|new_string.

### M6 — packages/distill (3–4 days)
**M6.1 Collect+cluster.** Read new records on `teambrain/sessions` since last watermark (stored in `.teambrain/brain.yaml` state block written by CI commit) + merged PR metadata via `gh pr list --json` (GitLab deferred, note in docs). Cluster signals: same-path struggles across ≥2 sessions; repeated failing commands; no-hit `memory_search` queries; agent candidates.
**M6.2 Draft.** One Provider call per cluster using versioned prompt `prompts/distill-v1.md`; zod-validate structured output into C1 candidates with evidence populated; invalid → discard + count.
**M6.3 Dedup+conflict.** Embed candidate; cosine ≥0.85 vs existing → drop or mark amendment; pairwise contradiction check vs top-3 neighbors (Provider call, fake-provider fixtures in tests) → set `supersedes` and flag.
**M6.4 Gate+PR.** Score = evidence_count × novelty(1−max_sim); top ≤10; write one file per candidate on branch `teambrain/proposals-<date>`; open PR via `gh` with a summary table body; run `tb lint` as the PR check (ship `ci-templates/lint.yml`).
Accept: golden pipeline test — `testdata/sessions/week-fixture/` (write it: 12 synthetic sessions engineered to contain exactly 3 legitimate clusters, 1 duplicate of an existing memory, 1 contradiction) → FakeProvider → assert: exactly 3 proposals, duplicate dropped, contradiction carries supersedes + PR-body flag, all proposals pass `tb lint`. `tb distill --dry-run` prints the would-be PR without git side effects.

### M7 — digest, doctor, CI templates (1–2 days)
**M7.1 `tb digest`.** Aggregates (proposed/approved/retired counts, top-retrieved, no-hit queries, stale ≥90d, rules-file drift hash check) → Slack webhook JSON. Structural guardrail: the aggregation module imports a projection of events that excludes any author/user field; add a test asserting the digest output contains no per-person data even when fed authored fixtures.
**M7.2 `tb doctor [--json]`** per Tech Brief §6. **M7.3 `ci-templates/`**: GitHub Actions for distill (weekly cron), digest (weekly), lint (on PR touching .teambrain/), sessions-branch rotation (monthly squash+prune). README for each.
Accept: unit tests + `tb doctor --json` schema test; templates pass `actionlint`.

### M8 — hardening & release (2 days)
**M8.1 Full-loop integration test** (the release test): fixture repo → `tb init` → merge init PR → `tb serve` → replay sessions → `tb distill` → merge proposal PR → assert new memory served by `memory_search` → `tb retire` → assert absence. Runs in CI nightly.
**M8.2 Packaging.** npm publish workflow (`--provenance`), standalone binaries via bun compile for mac-arm64/mac-x64/linux-x64, `tb doctor` self-check post-install.
**M8.3 Docs.** README (quick start <5 min), FORMAT.md (C1 spec), SECURITY.md (threat model summary incl. memory-poisoning stance), per-command help.
Accept: nightly loop test green 3 consecutive runs; `npm pack` installs clean on a bare container and `tb init && tb doctor` succeeds.

**Deferred (do NOT build in V1, even if tempting):** Cursor hooks (pending OQ-1 spike — stub the adapter interface only), cloud sync, web UI, GitLab distill driver, LLM reranking, org scope enforcement beyond schema.


---

## Standing guardrails (apply to every milestone)

1. **Contracts freeze:** if implementation reveals a schema flaw, the correct move is a written proposal in DEVLOG + ask — never a silent migration.
2. **No invented APIs:** for Claude Code hook/MCP specifics, trust the snippets in this document and `docs/`; if something doesn't match the installed Claude Code version, report the discrepancy rather than guessing (hook behavior changes between versions).
3. **Fixture-first:** when a task needs data (sessions, brains, queries), create the fixture as its own commit *before* the feature commit, so tests are reviewable against known inputs.
4. **The product's ethics apply to its own telemetry:** the build must never add analytics, phone-home, or network calls at runtime beyond git, the LLM Provider (distill only), and the Slack webhook (digest only). A CI test greps the bundle for fetch/http usage outside those three modules.

