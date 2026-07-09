# TeamBrain Continue Plan

The C-milestones are a completeness checklist, executed only where C0 shows gaps. Each names the BUILD_PLAN tasks it covers and the evidence of completion.

### C0 — State reconciliation (mandatory first, ~1 day)

**C0.1 Run full build/accepts.** On a clean clone, run `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm bench` and every per-milestone Accept command in `BUILD_PLAN.md` M0–M8. Capture raw results.

**C0.2 Task classification.** Classify every M-task DONE / PARTIAL / NOT STARTED (Section B) into `docs/internal/STATUS.md`, with the evidence for each classification and the identified continuation frontier.

**C0.3 Smallest next step.** For each PARTIAL/NOT STARTED task, note why (missing test, failing code, absent feature) and the smallest change to reach DONE.

**C0.4 Contract sanity check.** Sanity-check against `CONTRACTS.md` and `CLAUDE.md` privacy rules so "continue" doesn't build atop a contract violation (`grep` capture paths for `content|old_string|new_string`; confirm no network calls outside git/Provider/webhook).

Accept: `STATUS.md` committed with a per-task table and a named frontier; the build runs (even if some feature Accepts fail — those become the work).

### C1 — Complete the core loop to first-value (covers M1–M2 gaps)

**C1.1 Finish core format and import.** Finish whatever is PARTIAL in: brain format + `tb lint` (M1), `tb init` importer + interview (M2). The bar: on a fresh fixture repo, `tb init` imports existing `CLAUDE.md`/`.cursorrules`/`AGENTS.md`/ADRs into a valid `.teambrain/` on a branch, main untouched, ≥90% text preserved.

Accept: M1 + M2 Accept commands green, including the ≥90%-preservation assertion and the poisoned-brain lint test.

### C2 — Complete retrieval + MCP serving (covers M3–M4 gaps)

**C2.1 Finish hybrid search and daemon.** Finish whatever is PARTIAL in: index (M3, hybrid FTS5+vector RRF, source dimension present, join keys preserved), MCP server + daemon (M4, the four tools, data-not-instructions rendering, freshness watcher, `tb install claude-code`).

Accept: M3 + M4 Accept commands green — including the retired-memory-disappears-within-one-watcher-cycle negative test, p95<300ms bench, and idempotent `tb install`.

### C3 — Complete capture + redaction (covers M5 gaps)

**C3.1 Finish capture and redaction.** Finish whatever is PARTIAL in: Claude Code hooks, spool, sessions branch, `tb audit`, redaction engine + public corpus.

Accept: M5 Accept commands green — replayed fixture session yields C2-valid JSONL with zero un-redacted corpus strings, hook handler <20ms p95, and the assertion that no event carries `content|old_string|new_string`. Also assert (Product Brief v2.0 P0): every event carries sid/repo/branch/tool/model, `session_end` carries `commit_shas` — a missing join key fails validation.

### C4 — Complete the distiller → memory-PR (covers M6 gaps)

**C4.1 Finish the distiller pipeline.** Finish whatever is PARTIAL in the distiller: collect → cluster → draft (versioned prompt, structured-output validated) → dedup+conflict → gate → open memory PR. Include the per-team few-shot flywheel.

Accept: M6 golden pipeline test green (the engineered 12-session fixture → exactly 3 proposals, duplicate dropped, contradiction carries supersedes + PR-body flag, all pass `tb lint`); `tb distill --dry-run` has no git side effects.

### C5 — Complete digest, doctor, CI templates (covers M7 gaps)

**C5.1 Finish digest and templates.** Finish whatever is PARTIAL in: `tb digest` (aggregate-only, author-field-excluded projection + test), `tb doctor --json`, `ci-templates/` (distill cron, digest, lint-on-PR, sessions-branch rotation).

Accept: M7 Accept commands green; digest contains no per-person data even on authored fixtures; templates pass `actionlint`.

### C6 — Cursor capture (M-plan's deferred OQ-1; the one net-new V1 task)

**C6.1 Resolve Cursor deferred work.** If the original build stubbed Cursor (as planned), resolve it now — it is part of V1's cross-vendor promise. Timeboxed spike (≤2 days) → decision memo in `DEVLOG` (native hooks / MCP-side inference / rules-directive fallback) → implement in `packages/hooks/cursor/`, reuse the socket client, `tb install cursor` idempotent, degraded modes explicit in `tb doctor`.

Accept: Cursor parity fixture (`testdata/sessions/raw-cursor.jsonl`) → C2-valid records; per-tool capture matrix in `README`; no Claude Code regression.

### C7 — V1 completion gate (covers M8)

**C7.1 Finish the release milestone.** The release/full-loop milestone. Finish M8: end-to-end test (`tb init` → merge init PR → serve → replay sessions → distill → merge proposal PR → assert new memory served → retire → assert absent), packaging (`npm --provenance`, standalone binaries), docs (README quick-start, `FORMAT.md`, `SECURITY.md`).

Accept: nightly full-loop test green 3 consecutive runs; `npm pack` installs clean on a bare container and `tb init && tb doctor` succeeds; the README install command actually works on a fresh machine (verify — likely currently unpublished).
