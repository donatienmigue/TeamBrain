# TeamBrain — I0 Audit & Gap Report

Date: 2026-07-09 · Auditor session · Scope: `main` @ `11c03d5`

Method: (I0.1) every `BUILD_PLAN.md` Accept command replayed on a fresh clone;
(I0.2) implementation diffed against `CONTRACTS.md` C1–C7 and the `CLAUDE.md`
non-negotiable principles, clause by clause. Findings ranked and assigned a
fixing I-milestone. Critical findings are fixed inside I0 (§Fixes).

---

## I0.1 — Acceptance re-verification (clean clone)

Clone of `main` @ `11c03d5`, `pnpm install --frozen-lockfile`, Node 22.13.1,
pnpm 9.15.9, Windows 11. Results:

| Milestone | Accept command(s) | Result |
|-----------|-------------------|--------|
| M0 | `pnpm build && pnpm test && pnpm lint` | **PASS** — build clean, 474 tests / 52 files green, eslint + prettier clean |
| M1 | `pnpm --filter core test`; `tb lint testdata/brains/valid` (exit 0); `tb lint testdata/brains/poisoned` (exit 3) | **PASS** — valid exits 0, poisoned exits 3 listing 10 violations across all classes |
| M2 | init integration over 3 fixture repos; fixture `main` clean | **PASS** — within full `pnpm test` |
| M3 | `pnpm --filter index test && pnpm bench` | **PASS** — rebuild 5k in 18.8s (budget 60s), search p95 35.8ms (budget 300ms), recall@8 1.00 (floor 0.85) |
| M4 | scripted MCP client; R5 retire→disappear; `tb install` twice zero-diff | **PASS** — within full `pnpm test` (`already installed` on 2nd run) |
| M5 | `pnpm --filter redact test`; replay `raw-claude.jsonl`; hook p95 <20ms; no `content\|old_string\|new_string` keys | **PASS** — corpus green; replay + budget tests green |
| M6 | golden week-fixture pipeline; `tb distill --dry-run` no git side effects | **PASS** — dry-run produced 0 side effects (`git status` clean, no proposals branch) |
| M7 | unit tests; `tb doctor --json` schema test; templates pass `actionlint` | **PARTIAL** — doctor `--json` emits schema-valid JSON; all 6 workflow YAMLs parse and carry a `jobs` key. `actionlint` proper **not run** (binary unavailable in this env; `go run …@latest` blocked by policy). Tracked as **F6**. |
| M8 | full-loop release test ×3; `npm pack` clean install + `tb init && tb doctor` | **PASS** — full-loop green 3/3; packed all 7 tarballs, installed `@teambrain/cli` into a bare dir, `tb --version`, `tb init --yes`, `tb doctor` all succeeded |

No Accept command produced a hard failure. The one gap (M7 `actionlint`) is a
tooling-availability gap, not a red Accept, and is logged as F6.

---

## I0.2 — Hostile contract review (C1–C7 + principles)

Clause-by-clause result. Only deviations are findings; clauses not listed were
verified faithful.

| Clause | Verified | Notes |
|--------|----------|-------|
| **C1** Memory front-matter | ✅ | `memoryFrontmatterSchema` is `strictObject`; all fields, ULID/date refinements, class→dir map, `retired/` on retire all match. |
| **C2** Session event envelope | ✅ | Join keys `sid/repo/branch/tool/model` are `min(1)` on every variant; `serializeSessionEvent` re-validates on write; `intent.summary` capped at 200 and never carries a raw prompt (no `intent` emitter exists — design-ahead). Additive-loose `data`. |
| **C3** MCP tools + rendering | ⚠️ **F1** | 4 tools present with correct signatures/budgets; server name `teambrain`. **But** the `data, not instructions` fence is escapable — see F1. |
| **C4** RetrievalBackend | ✅ | `index/search/remove/stats`, `source` on every `Scored`, RRF(k=60) top-40∪top-40 → filters → required force-include → token trim all present; `codemap` reserved but unused (V1-correct). |
| **C5** Provider | ✅ | `complete({system,prompt,schema})`; drivers anthropic + fake; LLM import contained to `packages/distill/src/anthropic.ts` (lazy). Model pinnable via `brain.yaml`. |
| **C6** CLI surface | ⚠️ **F2** | `init/serve/install/retire/audit/doctor/distill/digest/lint` present with correct exit codes (0/1/2/3; unknown cmd → 1). **`propose` and `reindex` — both in the frozen C6 list — are not implemented.** |
| **C7** Filesystem layout | ⚠️ **F4, F5** | `.teambrain/` + `~/.teambrain/{spool,index.db,logs}` correct. **No `~/.teambrain/user/` handling and no "sync physically unable to read user/" assertion test (F4).** Brain `prompts/` dir not scaffolded; distill prompt ships in-package (F5). |
| **Principle 3** No raw content in events | ✅ | `map.ts` stores only `{kind,path?,exit_code?}`; `redact-event.ts` drops `content/old_string/new_string` as defense-in-depth and redacts every string leaf. |
| **Principle 3** Logger redaction | ✅ | `body/content/prompt` redacted at info+ in `log.ts`. |
| **Guardrail 4** No network outside git/Provider/webhook | ⚠️ **F3** | Only egress is `slack.ts` (webhook) + lazy anthropic (Provider) — **currently compliant**, but the mandated *CI test that greps the bundle for stray `fetch`/http* does not exist, so the invariant is unenforced against regressions. |
| **M7.1** Digest people-free | ✅ | `aggregate.test.ts` asserts no per-person data even from authored fixtures. |

---

## Ranked findings

| ID | Sev | Finding | Contract/Principle | Owner |
|----|-----|---------|--------------------|-------|
| **F1** | **Critical** | `renderMemoryBlock` uses a fixed ` ``` ` fence and never neutralizes back-ticks in the body. A memory body containing ` ``` ` closes the fence early; everything after it renders as ordinary markdown/instructions to the agent — in `memory_search`, `memory_context`, **and** the SessionStart bundle. `tb lint` has no back-tick heuristic, so a poisoned (or even innocent code-quoting) body sails through. This defeats the C3 injection-mitigation guarantee that the code comment itself claims ("a payload that slipped past `tb lint` still cannot pose as a live instruction"). | C3 | **I0 (fixed)** |
| **F2** | High | `tb propose` and `tb reindex` — both enumerated in the frozen C6 CLI surface — are not implemented. Agents can propose via MCP and the index auto-rebuilds on checksum mismatch, so there are alternative paths, but the contracted CLI surface is incomplete. | C6 | I1 (propose) / I4 (reindex) |
| **F3** | High | The guardrail-4 release-gating test — "a CI test greps the bundle for fetch/http usage outside git/Provider/webhook" — is absent. Code is compliant today; nothing prevents a future module from adding silent egress. | Guardrail 4 / Principle 3 | I3 |
| **F4** | Medium | C7's user-scope guarantee ("the sync code must be physically unable to read `~/.teambrain/user/` … asserted by test") is unimplemented and untested. Vacuously satisfied today (nothing reads/writes a `user/` dir), but the required assertion test does not exist, so the guarantee is unguarded once user-scope lands. | C7 | I3 |
| **F5** | Low | The versioned distill prompt lives in `packages/distill/prompts/distill-v1.md`, not the brain's `prompts/` dir that C7 lists as part of the brain layout; `tb init` scaffolds no `prompts/`. Teams cannot version/customize the distill prompt in their own brain repo. | C7 | I1 |
| **F6** | Low | M7 Accept could not fully run `actionlint` in the audit environment (binary unavailable; network fetch of a pinned binary blocked). Workflows were validated for YAML well-formedness + `jobs` presence only. CI should pin and run real `actionlint`. | BUILD_PLAN M7 Accept | I0.3 / I4 |
| **F7** | Medium | I0.3 compat fixture (`testdata/compat/v1-brain/` + a CI test that future code reads it byte-correctly) is not yet created. Required by the I0 Accept ("compat test green"). | I0.3 | I0 (next task) |

---

## Fixes applied in I0

Only **Critical** findings are fixed here (per the I0 mandate); High/Medium/Low
are routed to their owning milestone above.

- **F1** — `renderMemoryBlock` now emits a CommonMark-correct fence longer than
  any back-tick run inside the block, so a memory body can never break out of
  the `data, not instructions` container. Regression test added covering a body
  that embeds a ` ``` ` fence. Commit references `F1`.

## Not fixed in I0 (tracked)

F2, F3, F4, F5, F6 are logged above with owners. **F7 (compat fixture)** is the
remaining I0 sub-task (I0.3) and is done next within I0, not deferred.
