# TeamBrain Improve Plan

### I0 — Audit & gap report (1–2 days)

**I0.1 Acceptance re-verification.** Run every Accept command from `BUILD_PLAN.md` M0–M8 on a clean clone (fresh container if possible). Record pass/fail per milestone in `docs/internal/AUDIT.md`.

**I0.2 Hostile contract review.** Diff the implementation against `CONTRACTS.md` clause by clause (C1–C7): schema fields, MCP tool signatures and the data-not-instructions rendering rule, CLI exit codes, the user-scope physical-separation guarantee, join keys on every event. Also verify `CLAUDE.md` principles: no raw content in events (`grep` for `content|old_string|new_string` keys in capture paths), no network calls outside git/Provider/webhook, logger redaction at info+.

**I0.3 Compat fixture.** Generate `testdata/compat/v1-brain/` from current main (init + a few approved/retired memories + a session record) and add a CI test that future code reads it byte-correctly.

**I0.4 Findings triage.** `AUDIT.md` ends with a ranked findings table (Critical / High / Medium / Low) with proposed owners (which I-milestone fixes each). Critical findings are fixed inside I0 before anything else proceeds.

Accept: `AUDIT.md` committed; all `BUILD_PLAN` Accept commands green or their failures captured as Critical findings and fixed; compat test green.

### I1 — v2.0 repositioning obligations (2–3 days)

**I1.1 FlightDeck data-model enforcement (P0).** Add schema-level tests asserting every emitted event carries `sid/repo/branch/tool/model` and every `session_end` carries `commit_shas` — an event missing a join key must fail validation at write time, not be silently accepted. Add the same assertion to the end-to-end release test.

**I1.2 Governance-friction: memory-PR ergonomics.** Redesign the distiller's PR output for <60s per-candidate review: PR body leads with a one-line verdict per candidate (title · class · evidence count · conflict flag), collapsible detail sections, per-candidate suggested `tb` commands for partial acceptance (merge some, drop others without hand-editing). Add a golden-output test for the PR body.

**I1.3 Review-time instrumentation.** `tb digest` (and `tb doctor --json`) report median memory-PR time-to-merge (via `gh pr list --json` on `teambrain/proposals-*` branches). Aggregate only. This is the product G2 metric — it must be measurable from day one.

**I1.4 OQ-7 instrumentation (metadata-signal sufficiency).** From existing events only, compute and emit per-week aggregates into the digest: retry-loop counts, plan revisions/session, no-hit `memory_search` queries, session outcome mix, memory-retrieval→outcome co-occurrence. No new capture, no per-person data — this is the evidence base for whether FlightDeck can live on metadata. Document the computed signals in `docs/internal/PRACTICE_SIGNALS.md`.

Accept: join-key negative test green; PR-body golden test green; digest shows review-time + practice-signal aggregates on fixture data; `pnpm test && pnpm bench` green.

### I2 — Cursor capture adapter (OQ-1 resolution) (3–4 days)

**I2.1 Timeboxed spike (max 2 days).** Implement against Cursor's current hooks surface; document exactly which C2 events are natively capturable. Decision memo in `DEVLOG`: native hooks / MCP-side session-boundary inference / rules-directive fallback — or a hybrid.

**I2.2 Implementation.** Implement per decision in `packages/hooks/cursor/`, reusing the socket client; `tb install cursor` (idempotent, diff-shown); degraded-mode behavior explicit in `tb doctor` (`cursor: capture=partial (no plan_revision events)`).

**I2.3 Parity fixture.** `testdata/sessions/raw-cursor.jsonl` replayed through the adapter must produce C2-valid records; document the per-tool capture matrix in `README`.

Accept: `tb install cursor` wires a working config; parity test green; doctor reports per-tool capture level; no Claude Code regression.

### I3 — Robustness & security hardening (2–3 days)

**I3.1 Memory-poisoning red team.** Expand `testdata/brains/poisoned/` with ≥15 new adversarial memories (indirect injection via markdown links/footnotes, unicode homoglyph evasion of existing patterns, instruction-in-YAML-field, oversized-body smuggling). Every case must be caught by `tb lint` or neutralized by the data-not-instructions rendering — add the rendering-neutralization test if missing.

**I3.2 Redaction corpus growth.** ≥200 total cases; add: private keys in multiline YAML, .env-style blobs in command args, JWTs split across events, tricky negatives (ULIDs, git SHAs, sqlite-vec base64). Corpus remains a release gate.

**I3.3 Git edge cases.** Tests + fixes for: shallow clones, worktrees, detached HEAD, brain in a monorepo subdirectory, brain repo ≠ code repo, force-pushed sessions branch, two daemons on one repo (lockfile behavior).

**I3.4 Parser fuzz.** Property-based fuzz of the front-matter parser (fast-check): random valid mutations must round-trip; random invalid input must produce typed errors, never a crash or silent acceptance.

Accept: all new fixtures green; fuzz run (≥10k cases) clean in CI nightly; no corpus regressions.

### I4 — Performance & DX polish (1–2 days)

**I4.1 Bench honesty.** Re-verify budgets on the 5k fixture with the compat brain loaded; add cold-start (daemon boot→first retrieval) to `pnpm bench` with a <2s budget.

**I4.2 Failure-mode UX.** Every error path in `tb init/install/serve/doctor` prints a one-line cause + one-line fix (test the top 10 via fixture-induced failures). `tb doctor` gains `--fix` for the safe ones (stale index → reindex; missing hook → reinstall prompt).

**I4.3 Windows/WSL smoke in CI.** Matrix job: install → init → serve → one retrieval.

Accept: bench green with new budgets; error-message snapshot tests; WSL job green.

### I5 — CodeMap (R16) — codebase memory (4–6 days; only after I0–I2 merged)

Build exactly to `TECH_BRIEF` §4.8. Summary of the spec (the brief is authoritative):

**I5.1 Manifest + incremental summarizer.** `packages/codemap/`: per-file content-hash manifest; on CI merge, re-summarize only changed files (Provider call, batched, team's key; local-model path supported); output markdown summaries to `.teambrain/codemap/` (git-tracked, diffable, NOT PR-gated — derived artifact).

**I5.2 Indexing.** Index codemap entries with source: `codemap` (C4's reserved value — the one authorized contract activation); per-source ranking weights and token budgets in `brain.yaml` (defaults: memories 2000 + codemap 1500).

**I5.3 Serving.** `memory_context()` adds a budgeted codemap slice scoped to repo/branch/recent-files; `memory_search` searches both sources, results tagged. Zero new MCP tools — hard constraint; if a new tool seems needed, stop and report.

**I5.4 Budget isolation & staleness tests.** Negative test: a flood of codemap entries never displaces a required memory nor shrinks the governed-memory budget. Staleness test: change a file in the fixture repo → merged → its codemap answer reflects the change within one cycle.

**I5.5 Effectiveness instrumentation.** Measure exploration proxies from existing `tool_use` events (file-read/grep-like actions per session) before/after codemap enablement on the dogfood repo; report in the digest. Target signal: ≥30% reduction (product acceptance — measured over weeks, so instrument now, judge later).

**I5.6 CI template.** `ci-templates/codemap.yml` (on merge to default branch) + README section.

Accept: incremental update <2 min on the 500k-LOC synthetic fixture (generate one); budget-isolation and staleness negative tests green; zero new MCP tools (assert via tool-list snapshot test); full-loop release test still green with codemap enabled AND disabled (feature flag `codemap.enabled`, default off until dogfood sign-off).

### I6 — Release & launch readiness (1–2 days)

**I6.1 Publish pipeline.** `npm publish` with `--provenance` on tag; standalone binaries (mac arm64/x64, linux x64); v0.1.0 release with generated CHANGELOG. The README's `npm install -g @teambrain/cli` must actually work on a bare machine — this is currently unverified (no releases published).

**I6.2 Repo housekeeping.** Topics/description, `ROADMAP.md` (the launch package references it; content: I-phase summary + V1.1 CodeMap GA + FlightDeck preview), badges wired to real CI, `CONTRIBUTING` "good first issues" seeded from Low-severity audit findings.

**I6.3 Launch alignment.** Verify README claims against reality post-I2/I5 (per the launch package: HN will git clone and check) — especially the capture matrix and any performance numbers.

Accept: clean-container install test green in CI; tagged release exists; README claims each have a test or a caveat.
