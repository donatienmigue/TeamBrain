# Status — post-V1 baseline (D0, verified 2026-07-10)

V1 (M0–M8, C0–C7) is complete. This document is the D0 ground-truth
verification required by docs/internal/POSTV1_PLAN.md: every claim below was
re-checked on this date with the evidence shown, on a clean clone of `main`
(commit 6a86747) and against the live npm registry. It supersedes the previous
M0–M8 tracking table (all DONE; see git history of this file).

## D0.1 — Full suite on a clean clone

Clean `git clone` → fresh `pnpm install --frozen-lockfile`. All green:

| Command | Result | Evidence |
|---|---|---|
| `pnpm build` | PASS | tsc -b, exit 0 |
| `pnpm test` | PASS | 60 files, 504/504 tests |
| `pnpm lint` | PASS | eslint + prettier clean |
| `pnpm bench` | PASS | rebuild 5k docs 22.6s (budget 60s); search p50 38.7ms (budget 80ms), p95 53.0ms (budget 300ms); recall@8 1.00 (floor 0.85) |
| `pnpm test:integration` | PASS | 8 files, 43/43 tests (incl. full-loop e2e release test) |

**Windows finding (feeds D5.3):** a fresh clone on Windows **fails checkout**
without `git clone -c core.longpaths=true` — 16 memory-fixture filenames
exceed MAX_PATH when the clone path is deep ("Filename too long", exit 128).
Also, `pnpm install` warns `Failed to create bin …/dist/tb.js.EXE` because the
bin target doesn't exist until `pnpm build` runs (cosmetic, but noisy).

## D0.2 — The three "ground-truth gaps": two of three are already closed

The post-V1 instructions assumed (a) npm install broken, (b) no Cursor
adapter, (c) no usage evidence. Verified state:

### Gap 1 — "npm install doesn't work": **CLOSED** (stale claim)
All seven `@teambrain/*` packages are published at **0.0.1** (`npm view`
confirms each). Bare-machine check against the live registry (fresh npm
prefix, scratch git repo):
`npm i -g @teambrain/cli` → 196 packages in 24s → `tb --version` → `0.0.1` →
`tb init` runs correctly (reports nothing to import in an empty repo) →
`tb doctor` runs. Publishing CI exists: `publish.yml` (push-to-main, publishes
version bumps) and `release.yml` (tag `v*` → npm publish with provenance +
mac/linux `bun --compile` binaries attached to the GitHub Release).

**Still open from D1:**
- No git tag / GitHub Release has ever been cut (D1.4: `v0.1.0`).
- No bare-machine post-publish install smoke job in CI (D1.2).
- No `CHANGELOG.md` generation (D1.1, remaining half).
- Finding: `tb doctor` run in a repo **without** a brain reported the state of
  a *different* repo's daemon/brain (the dev repo) instead of "no brain here",
  and exited 0 while `daemon running: FAIL`. Doctor's repo-scoping and exit
  code need a look (D5.1 candidate).

### Gap 2 — "no Cursor capture": **CLOSED in code, overclaimed in README**
`packages/hooks/src/cursor/` (CursorInterceptor, MCP-side session inference)
exists, is wired via `packages/cli/src/cursor-wrapper.ts`, has a parity
fixture `testdata/sessions/raw-cursor.jsonl`, `tb install cursor` is
idempotent, and the README publishes a capture matrix. Tests green.

**Findings (feed D2 residual work):**
- `session_end` is only inferred when `memory_propose` is called — a Cursor
  session that never proposes **never emits session_end** (no timeout/exit
  inference). `duration_s` is always 0, `outcome` always `unknown`,
  `commit_shas` always `[]`.
- README overclaim: "Sessions and their resulting commits are still captured"
  — commits are **not** captured for Cursor (`commit_shas: []`
  unconditionally). The matrix row is honest; this sentence is not.
- `cursor-wrapper.ts` uses `sendHookEvent(...).catch(() => {})` — a silent
  catch, forbidden by CLAUDE.md ("degradation must be logged at debug level").

### Gap 3 — "no external usage evidence": **CONFIRMED, still true**
0 releases, 0 tags; only capture evidence is this repo's own dogfooding
(doctor shows 88 claude-code events). This is the scarce resource. D1.4 +
launch remain the path.

## D0.3 — Privacy/contract re-audit: **PASS**

- **No content in events:** capture mappers never read
  `content|old_string|new_string` into events; `redact-event.ts` drops those
  keys structurally (defense in depth) and `replay.integration.test.ts`
  asserts no content key ever appears in produced JSONL.
- **No network egress outside git/Provider/webhook:**
  `packages/cli/src/egress-guard.test.ts` scans all shipped source for
  fetch/http/ws/SDK imports; allowlist is exactly `distill/src/anthropic.ts`
  (C5 Provider), `cli/src/digest/slack.ts` (webhook), and
  `index/src/embeddings.ts` (checksum-pinned one-time model download,
  AUDIT.md F8) — with a negative control so the scanner can't go vacuous.
- **FlightDeck P0 join keys:** `packages/core/src/events.ts` zod-enforces
  `v/sid/t/tool/model/repo/branch` on **every** event via shared envelope
  fields; `session_end` requires `commit_shas: string[]`.

## D0.4 — Compat fixture: **already frozen and gated**

`testdata/compat/v1-brain/` exists (4 active memories across all classes,
1 retired, brain.yaml, sessions JSONL) and
`packages/core/src/compat-v1.test.ts` round-trips every file
**byte-exactly** (parse → serialize → identical bytes) plus field-value
assertions; runs in `pnpm test`, therefore in CI on every push. The test
header forbids regenerating the fixture to make it pass.

## Consequence for the D-milestone plan

| Milestone | Real remaining scope |
|---|---|
| D0 | **DONE** (this document). |
| D1 | **BLOCKED on the NPM_TOKEN secret.** v0.1.0 is bumped, tagged, and pushed; both publish workflows failed at "Publish to npm" (2026-07-10) with nothing reaching the registry — the token has publish rights historically (0.0.1 is live) but now fails, consistent with npm's 2025 token expiry policy. Fix: mint a new granular automation token (or configure npm trusted publishing for the 7 packages), update the GitHub secret, re-run the `release` workflow on tag v0.1.0. Everything downstream (smoke gate, notes, binaries) then runs unattended. |
| D2 | **DONE.** Idle-timeout (30 min) session_end inference landed with negative tests; README matrix honest; parity fixture green. Cursor still cannot capture commit SHAs/outcome (inherent to no lifecycle hooks). |
| D3 | **DONE.** Practice signals + memory-value metrics in the digest (people-free by negative test); governance friction in digest + doctor --json; PR body redesigned with byte-exact golden; PRACTICE_SIGNALS.md verdict: conditional GO on metadata-only FlightDeck (no plan_revision emitter exists; co-occurrence labeled correlation). |
| D4–D5 | Full scope; add from D0: `core.longpaths` clone failure (D5.3), doctor repo-scoping/exit-code (D5.1), pnpm bin warning. |
| D6 | **DONE** (explicitly requested post-D3). CodeMap behind `codemap.enabled: false`: incremental hash-manifest summarizer in distill (`tb distill --codemap` + CI template), indexed under C4's reserved `source: 'codemap'`, served through the existing four MCP tools with an isolated 1500-token budget. Accept evidence: budget-isolation + staleness + disabled-flag + both-modes-e2e tests green; four-tool list snapshot unchanged; bench 500k-LOC incremental update 8.1s (<2 min budget). **Open item requiring human approval:** the ≥30% exploration-token measurement needs Read/Grep capture, i.e. a new C2 `tool_use.kind` value (`explore`) — a frozen-contract change; not done. |
