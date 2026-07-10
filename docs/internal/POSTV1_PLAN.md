# TeamBrain — Post-V1 Plan (milestones D0–D6)

Source: post-V1 development instructions (2026-07). Ordering principle:
**evidence and reach before surface area** — make it installable, make it
cross-vendor, instrument the proof, *then* extend. Any task that fails the
test "does this help someone install it, make it genuinely cross-vendor, or
prove a differentiator?" is deferred.

Standing guardrails (extend CLAUDE.md, don't replace):
1. Contracts frozen except C4's reserved `source` value, only if D6 (CodeMap) is reached.
2. No refactor without a finding from D0's STATUS.md or a named task.
3. Every new capability ships a negative test.
4. Compat forever: a `.teambrain/` brain created by today's `main` must stay
   readable by all future code (D0 captures the fixture).
5. Privacy invariants are release-gating: no raw content in events; digest has
   no per-person data; redaction corpus green. Re-assert in CI, never weaken.
6. No new MCP tools, ever, without stopping to report.

---

### D0 — Verify ground truth & freeze a baseline (mandatory first, ~1 day)
**D0.1** Clean clone; run `pnpm install && pnpm build && pnpm test && pnpm test:integration && pnpm lint && pnpm bench` and the e2e release test. Record pass/fail in `docs/internal/STATUS.md`.
**D0.2** Confirm the three ground-truth gaps: attempt `npm install -g @teambrain/cli` in a clean container (expect failure — document the exact error); grep `packages/hooks/` for any Cursor adapter (expect none); confirm capture matrix in README vs. reality.
**D0.3** Privacy/contract re-audit: grep capture paths for `content|old_string|new_string`; confirm no network calls outside git/Provider/webhook; confirm every event carries `sid/repo/branch/tool/model` and `session_end` carries `commit_shas` (the FlightDeck P0 keys).
**D0.4** Freeze `testdata/compat/v1-brain/` from current `main` + a CI test reading it byte-correctly.
Accept: STATUS.md committed (per-package state, the three gaps confirmed with evidence, privacy invariants verified); compat fixture test green.

### D1 — Make it actually installable (P0 — the launch blocker)
The README promises an install that doesn't exist. Fix that end to end.
**D1.1 Publish pipeline.** GitHub Actions release workflow: on tag `v*`, build all packages, publish `@teambrain/cli` (and any runtime-dep packages) to npm with `--provenance`; generate `CHANGELOG.md` from conventional commits.
**D1.2 Bare-machine install test.** CI job on a clean container: `npm install -g @teambrain/cli@<tag>` → `tb --version` → `tb init` in a scratch repo → `tb doctor`. Must pass before a release is allowed to stand (post-publish smoke gate).
**D1.3 Standalone binaries.** `bun build --compile` (or equivalent) for mac-arm64/mac-x64/linux-x64 attached to the GitHub Release, for users without a Node toolchain (the daemon model needs a warm process; document the binary path).
**D1.4 Cut `v0.1.0`.** First real release. README install command now verified true.
Accept: a published `v0.1.0` exists; the bare-machine install job is green; `tb init && tb doctor` succeeds from the published package on a fresh container.

### D2 — Finish the cross-vendor promise: Cursor capture (P0 — OQ-1)
Serving is already vendor-neutral over MCP; **capture is not** — and "cross-vendor" is a core positioning claim. Close it.
**D2.1 Timeboxed spike (≤2 days).** Implement against Cursor's current hooks surface; document exactly which C2 events are natively capturable. DEVLOG decision memo: native hooks / MCP-side session-boundary inference / rules-directive fallback / hybrid.
**D2.2 Implement** in `packages/hooks/cursor/`, reusing the existing socket client; `tb install cursor` idempotent with diff shown; degraded modes explicit in `tb doctor` (e.g. `cursor: capture=partial (no plan_revision)`).
**D2.3 Parity fixture** `testdata/sessions/raw-cursor.jsonl` → replay → C2-valid records; publish the honest per-tool capture matrix in the README (no overclaiming — HN will check).
Accept: `tb install cursor` wires a working config; parity test green; per-tool capture matrix in README; no Claude Code regression; e2e release test still green.

### D3 — Instrument the differentiators (runs alongside D1/D2; validates the whole thesis)
V1 can capture data but hasn't been made to *prove* the two things the product is bet on. Per Product/Tech Brief v2.0.
**D3.1 Governance-friction metric (product G2).** `tb digest` + `tb doctor --json` report median memory-PR time-to-merge (via `gh pr list --json` on `teambrain/proposals-*`). Redesign the distiller PR body for <60s/candidate review (one-line verdict per candidate: title · class · evidence · conflict flag; collapsible detail; partial-accept commands). Golden-output test for the PR body.
**D3.2 FlightDeck-signal sufficiency (OQ-7 — the load-bearing question).** From existing events only, compute weekly aggregates into the digest: retries/session, plan revisions/session, no-hit `memory_search` queries, outcome mix, retrieval→outcome co-occurrence. No new capture, no per-person data. Document in `docs/internal/PRACTICE_SIGNALS.md` with a written verdict: *is there enough signal in metadata to build FlightDeck without content capture?* This gates the entire FlightDeck bet.
**D3.3 Memory-value metric (product G1).** Instrument context-setup turns/session and memory-retrieval rate; surface in digest. This is the on-ramp proof.
Accept: digest shows governance-friction + practice-signal + memory-value aggregates on fixture data; PR-body golden test green; PRACTICE_SIGNALS.md contains a reasoned go/no-go on metadata-only FlightDeck.

### D4 — Hardening the trust surface (after D1–D2 shipped)
The differentiator is trust; make it withstand adversaries.
**D4.1 Memory-poisoning red team.** ≥15 new adversarial memories in `testdata/brains/poisoned/` (indirect injection via markdown links/footnotes, unicode homoglyphs, instruction-in-YAML, oversized-body smuggling). Each caught by `tb lint` or neutralized by data-not-instructions rendering (add that test if absent).
**D4.2 Redaction corpus → ≥200 cases** (multiline-YAML private keys, .env blobs in args, split JWTs, tricky negatives: ULIDs, git SHAs, sqlite-vec base64). Release-gating.
**D4.3 Git edge cases.** Shallow clones, worktrees, detached HEAD, brain-in-monorepo-subdir, brain≠code repo, force-pushed sessions branch, two daemons/one repo (lockfile).
**D4.4 Parser fuzz** (fast-check ≥10k cases): valid mutations round-trip; invalid input → typed errors, never crash/silent-accept.
Accept: new fixtures green; nightly fuzz clean; no corpus regressions.

### D5 — DX & reliability polish
**D5.1** Every `tb` error path prints one-line cause + one-line fix (snapshot-tested on the top 10 induced failures); `tb doctor --fix` for safe repairs (stale index→reindex; missing hook→reinstall prompt).
**D5.2** Cold-start budget in `pnpm bench` (daemon boot→first retrieval <2s), verified with the compat brain loaded.
**D5.3** Windows/WSL smoke job in CI (install→init→serve→one retrieval).
Accept: error snapshot tests green; bench green with cold-start budget; WSL job green.

### D6 — CodeMap (R16) — OPTIONAL, only if D0–D3 are green and dogfood shows the need
Build strictly to Tech Brief §4.8, behind `codemap.enabled=false` by default. **Do not start unless** the governance loop is validated (D3) and there is a real signal that agents re-reading the codebase is a felt pain in actual usage — otherwise this is premature surface area. If built: incremental hash-manifest summarizer in CI → `.teambrain/codemap/` (git-native, not PR-gated) → index with `source:'codemap'` → served via existing `memory_context`/`memory_search` (zero new MCP tools) → budget-isolation + staleness negative tests → ≥30% exploration-token reduction measured from `tool_use` events.
Accept: incremental update <2 min on a 500k-LOC synthetic fixture; budget-isolation + staleness tests green; zero new MCP tools (tool-list snapshot); e2e test green with codemap both enabled and disabled.

---

Sequencing: **P0 spine = D0 → D1 → D2.** D3 is the strategic core
(PRACTICE_SIGNALS.md is a board-level artifact). FlightDeck dashboards, cloud
tier, SSO, multi-repo, GitLab remain out of scope this phase. CodeMap (D6) is
gated on evidence, not enthusiasm. When D1–D3 are green, run the OSS launch
package and recruit the 5 design partners; development past that point is
demand-driven.
