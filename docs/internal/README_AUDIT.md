# README claim audit — pre-launch verification (2026-07-10)

Method: every factual claim extracted, then verified by running it (clean
`npm i -g` prefix + scratch git repo, published package `@teambrain/cli@0.2.2`,
never the local workspace) or by a file:line reference. Verdicts: TRUE /
MISLEADING / FALSE / UNVERIFIABLE — nothing marked TRUE from prose. Raw
terminal transcripts: scratchpad `claim-audit.log` (quoted inline below).
No README or code edits were made; proposed corrections are at the end.

## Claims

| id | cat | claim (quote) | verification | verdict | evidence |
|---|---|---|---|---|---|
| R1 | C-FEATURE | "Git-native memory that Claude Code, Cursor, **and Codex** read from and write to" | capture/serving adapters per tool | **TRUE (fixed 2026-07-14)** | Codex adapter shipped as `mcp-inference` (Tier B): `tb install codex` registers the server in `~/.codex/config.toml` (idempotent, tested) and `tb mcp --client codex` wraps the inference interceptor, so `session_start`/`session_end` are actually emitted (install-codex.integration.test.ts; matrix test pins the README cells). |
| R2 | C-LINK | CI badge → actions/workflows/ci.yml | curl + latest run state | TRUE | HTTP 200; latest CI run on main: success (GitHub API, 2026-07-10). Badge is wired to the real workflow that runs the full suite (ci.yml `pnpm test`). |
| R3 | C-LINK | npm badge → @teambrain/cli | shields + registry | TRUE | Badge renders 0.2.2; `npm view @teambrain/cli version` → 0.2.2. (npmjs.com page returns 403 to curl — bot protection, page loads in a browser.) |
| R4 | C-LINK | License badge Apache-2.0 → LICENSE | file + package.json | TRUE | LICENSE present at repo root; every package.json `"license": "Apache-2.0"`. |
| R5 | C-LINK | MCP-compatible badge → modelcontextprotocol.io | curl + code | TRUE | HTTP 200; server built on official `@modelcontextprotocol/sdk` (packages/mcp/src/mcp-server.ts:4). |
| R6 | C-NUMBER | "re-sent and re-explored context is the dominant share of agentic token spend" | source attribution | **UNVERIFIABLE** | External industry stat with no citation. TECH_BRIEF cites "≈50–62%" equally unattributed. HN will ask "source?". Needs attribution or softening. |
| R7 | C-FEATURE | ".teambrain/ directory of plain-markdown memories (decisions, conventions, map, learnings)" | ran tb init; inspected tree | TRUE | Scratch run: branch `teambrain/init` contains `.teambrain/brain.yaml, memories/…` markdown (transcript); classes per CONTRACTS C1, memoryClassSchema (packages/core/src/memory.ts). |
| R8 | C-FEATURE | "served to any MCP-capable agent" | MCP server integration test | TRUE | mcp-server.integration.test.ts: scripted MCP SDK client calls all four tools over a linked transport; server is vendor-neutral stdio MCP. |
| R9 | C-FEATURE | "A CI job distills … into proposed memories, opened as a pull request" | code path | TRUE | ci-templates/distill.yml runs `tb distill`; distill-command.ts writes branch via proposals-branch.ts and opens the PR with `gh` (non-dry-run path). Golden pipeline test green. |
| R10 | C-TRUST | "Nothing enters the brain silently" (human approval) | write paths to memories/ | TRUE | Only writers: tb init → branch `teambrain/init` (run evidence: "Your current branch and working tree were not touched", branch list captured); distill → `teambrain/proposals-*` branch + PR; retire → PR (retire-command.ts). No code path commits to memories/ on the default branch; user-scope separation test additionally proves user files never reach pushed trees. |
| R11 | C-FEATURE | "No TeamBrain servers. Sync is `git push`." | egress scan | TRUE | egress-guard.test.ts:17-25 — network APIs allowed only in distill/anthropic.ts (Provider), cli/digest/slack.ts (webhook), index/embeddings.ts (checksum-pinned model download); scanner has a negative control. No TeamBrain-operated endpoint exists anywhere. |
| R12 | C-FEATURE | "`git clone` is a full export" | layout check | TRUE | All durable state is files in the repo (.teambrain/ + sessions branch); machine-local ~/.teambrain is cache/spool only (CONTRACTS C7; index rebuildable — `tb reindex`, brain.ts full-resync). |
| R13 | C-INSTALL | "`npm i -g @teambrain/cli`" (verbatim) | ran it, fresh prefix | TRUE | Exit 0, installs 0.2.2 (transcript). Also gated in CI per release: release.yml install-smoke job on a bare node:20 container. |
| R14 | C-INSTALL | "Quick start (5 minutes)" | timed the sequence | TRUE | Full sequence (install → init → install claude-code → serve → doctor ok) completed in ≈3 minutes in the scratch run, on Windows 11 + Node 22. |
| R15 | C-COMMAND | "tb init — imports CLAUDE.md/.cursorrules/AGENTS.md/ADRs **→ opens a PR**" | ran verbatim | **MISLEADING** | Import works (run: "Imported 1 memories … on branch teambrain/init"; integration tests cover claude-md/cursor/ADR sources). But it does **not open a PR** — it creates a local branch and prints "Open a pull request and merge it" as *your* next step (transcript, EXIT=0). With no remote it couldn't. |
| R16 | C-COMMAND | "tb install claude-code — registers MCP server + hooks (shows the diff first)" | ran verbatim | TRUE | Run: prints full unified diff of `.claude/settings.json` + `.mcp.json`, then "Aborted — no files written. Re-run with --yes"; with --yes: "Installed TeamBrain for claude-code (2 file(s) written)" (transcript). |
| R17 | C-COMMAND | "tb serve — start the local daemon" | ran it | TRUE | Daemon starts, prints socket + brain; `tb doctor` reaches it: "daemon running: ok … socket reachable: ok … index docs: 1" (transcript). |
| R18 | C-COMMAND | "Next Claude Code session prints: `Loaded 47 team memories.`" | grepped + read hook | **FALSE** | The string exists nowhere in the codebase (repo-wide grep: 0 hits). session-start-hook.ts:34-47 emits a *silent* `hookSpecificOutput.additionalContext` JSON payload — context is injected; **nothing is printed to the user**, and on failure it emits nothing at all. |
| R19 | C-LINK | "templates in ci-templates/" | ls | TRUE | ci-templates/{distill,digest,lint,sessions-rotation,codemap}.yml exist and are actionlint-gated in CI (ci.yml). |
| R20 | C-FEATURE | pipeline diagram "session runs → hooks capture (redacted, metadata-only) → CI distiller → PR → human approves → every agent" | each stage | TRUE | Stages: hooks (map.ts→redact-event.ts→emit), sessions branch (gitSessionSource), distill pipeline → PR (R9), serve to all tools (R8). Full-loop e2e integration test green (cli full-loop.integration.test.ts). |
| R21 | C-FEATURE | "Retrieval is local: SQLite + FTS5 + local embeddings (no API calls to read memory, works offline)" | code + egress scan | TRUE (one caveat) | store.ts: better-sqlite3 + FTS5 + sqlite-vec; embeddings are local ONNX (fastembed), degrading to lexical-only when absent (runtime tests pass `embedder: null` and everything works offline). Caveat: *first* embedder use downloads the model once (index/embeddings.ts, checksum-pinned, documented in SECURITY.md) — reading memories never calls an API. |
| R22 | C-FEATURE | "LLM calls happen only in the distiller, in your CI, with your key" | egress scan | TRUE | CONTRACTS C5 enforced by egress-guard.test.ts: the Anthropic SDK import is allowed only in distill/anthropic.ts; anything else fails the suite. |
| R23 | C-TRUST | "By default (capture.level: metadata): files touched, command exit codes, retries, outcomes" | event schema + capture run | TRUE (wording nit) | tool_use carries only {kind, path?, exit_code?} (core/events.ts:49-55); outcomes in session_end. Live capture evidence: `tb audit` shows a real event `{"ev":"tool_use","data":{"kind":"command"}}` (transcript). Nit: "retries" are *derived* from exit-code sequences in the digest (practice-signals.ts), not a stored field. |
| R24 | C-TRUST | "**Never raw prompts, file contents, or diff bodies**" | grep capture path + tests | TRUE | Mappers never read content into events (map.ts:9-11 comment is enforced): redact-event.ts:14-17 structurally drops `content|old_string|new_string` even if a mapper regresses; replay.integration.test.ts:121 asserts no content key (incl. `command`) in produced JSONL; intent is a ≤200-char local summary, never the prompt (events.ts:39). Grep of hooks capture path found content fields only in the dropper and its tests. |
| R25 | C-TRUST | "Redaction (secrets, PII, entropy scan) runs on-device before anything is written" | order of operations | TRUE | processHookPayload = parse → map → **redact** (run.ts:47) → only then fire-and-forget emit (dispatch.ts:32-43). Run evidence: `tb audit` prints "Redaction summary: 0 replacements" per session; replay test shows fixture secrets (AWS key, ghp_ token) replaced with «REDACTED:…» markers. |
| R26 | C-TRUST | "the redaction test corpus is public and release-gating" | corpus + CI wiring | **MISLEADING** (fixable in CI, not README) | Corpus is public (packages/redact testdata, in-repo) and green in `pnpm test`, which CI runs on every push and publish.yml runs before push-triggered publishes. **But release.yml's tag-triggered publish job runs build only — no tests** — so a tag release is not literally gated on the corpus. Either add `pnpm test` to release.yml (code/CI change, out of scope here) or soften "release-gating". |
| R27 | C-COMMAND | "Run `tb audit` to see exactly what a session recorded" | ran it | TRUE | Output lists the session's spool file and the raw JSONL events actually stored, plus redaction summary (transcript). |
| R28 | C-TRUST | "No individual metrics, no leaderboards … digest is aggregate-only by construction" | digest projection | TRUE | aggregate.ts:15-23 — the aggregator can only touch `AggregateEvent {ev, data}`, a projection that structurally drops sid/tool/model/repo/branch; practice-signals.ts groups by sid internally but its output is counts/distributions only, enforced by a negative test (practice-signals.test.ts "no identity-bearing event field survives"). |
| R29 | C-TRUST | "no phone-home" | egress scan | TRUE | R11 evidence; additionally digest webhook fires only when the operator configures $TEAMBRAIN_SLACK_WEBHOOK (digest-command.ts) — no default endpoint. |
| R30 | C-LINK | SECURITY.md / FORMAT.md / docs/DEVELOPMENT.md / CONTRIBUTING.md / LICENSE / docs/internal/BUILD_PLAN.md links | ls | TRUE | All files exist at the referenced paths. |
| R31 | C-FEATURE | "TeamBrain syncs those [CLAUDE.md/.cursorrules] *and* adds … learning from real sessions, across tools, with review" | init import + rules drift | TRUE | Import: R15 run; drift tracking: digest-command.ts collectRules hashes CLAUDE.md/AGENTS.md/.cursorrules/.cursor/rules vs brain baseline; learning loop: R20. |
| R32 | C-COMPAT | Matrix: Claude Code — install/session start/end/edits/search/propose all "Yes (Native Hook / MCP Tool)" | install run + hook tests | TRUE | Install run (R16) writes SessionStart/PostToolUse/Stop hooks (diff in transcript); mappers + replay tests cover all events; MCP tools live (R8). Live dogfood capture seen via `tb audit`. |
| R33 | C-COMPAT | Matrix: Cursor — `tb install cursor`; session start "Yes (MCP-side inference)"; end "Yes (inferred: memory proposal or 30-min idle timeout)"; edits "No (Degraded)"; search/propose "Yes" | code + tests | TRUE | install-command supports cursor (idempotent, tested); CursorInterceptor infers start on memory_context, end on propose or 30-min idle (interceptor.ts:14-45, CURSOR_IDLE_TIMEOUT_MS; 5 tests incl. negatives); no tool_use for Cursor — matrix says so. Footnote states commit SHAs/outcome not captured — matches interceptor (commit_shas: [], outcome 'unknown'). |
| R34 | C-COMPAT | Status: "Cursor capture **in progress** (context serving already works via MCP); Codex/Kiro adapters next" | vs. shipped code | **TRUE (fixed 2026-07-14)** | Status line rewritten: Claude Code + Gemini CLI native, Cursor + Codex degraded, Cline/Kiro/Antigravity explicitly blocked. It now matches the generated matrix one section above. |
| R35 | C-COMPAT | "macOS/Linux, Windows via WSL" | ran on native Windows | TRUE (conservative) | Understatement, not overstatement: the entire quick start ran natively on Windows 11 in this audit (transcript). CI runs ubuntu; binaries ship mac/linux. Claiming only WSL is safe. |
| R36 | C-NUMBER | "it needs ~5+ sessions/week to propose anything useful" | heuristic | UNVERIFIABLE (acceptable) | Product's own honest-limits guidance; framed as such ("Honest limits"). No change needed, cannot be falsified by a reader. |
| R37 | C-FEATURE | "multi-repo org brains aren't built yet" | code | TRUE | No multi-repo code exists; scope field is design-ahead only. Honest limit. |
| R38 | C-COMMAND | "`tb --help` (grouped commands, exit codes, examples)" | ran it | TRUE | Help output shows Quality/Setup/Daemon/Capture groups, exit-code table (0/1/2/3), and example blocks (transcript). |

## Summary

| Verdict | Count | Items |
|---|---|---|
| TRUE | 31 | — |
| MISLEADING | 2 | R15 (init "opens a PR"), R26 (corpus "release-gating") |
| FALSE | 1 | R18 ("prints: Loaded 47 team memories.") |
| UNVERIFIABLE | 2 | R6 (unattributed token-spend stat), R36 (sessions/week heuristic — acceptable as framed) |

### Ranked findings

| Rank | Sev | Id | Problem | Minimal fix |
|---|---|---|---|---|
| 1 | **Critical (install/first-run)** | R18 | The README's only "what you'll see" promise is a string the product never prints. First thing a tester checks. | Describe the real behavior: context is injected silently; verify with `tb doctor`. |
| 2 | **High (compat)** | R1 | (FIXED) Tagline names Codex as reading *and writing* today; no Codex adapter exists. | "Claude Code, Cursor, and any MCP-capable agent" (Codex stays in roadmap line). |
| 3 | **High (compat)** | R34 | (FIXED) Status says Cursor capture "in progress" while the matrix above says it ships (degraded). Internal contradiction. | "Cursor capture shipped in degraded mode (no edit/command telemetry)". |
| 4 | **Medium (command)** | R15 | `tb init` does not open a PR; it creates a PR-ready branch and tells you to open one. | "→ creates a PR-ready branch". |
| 5 | **Medium (trust)** | R26 | "Release-gating" is true for pushes (CI + publish.yml) but the tag-release job doesn't run tests. | Preferred: add `pnpm test` to release.yml publish job (separate approved change). README fallback: "CI-gating". |
| 6 | **Medium (number)** | R6 | Bare unattributed industry stat; HN will demand a source. | Soften to "a large share" or attribute. |
| 7 | **Low (trust wording)** | R23 | "retries" are derived, not recorded fields. | "command failures (from which retries are derived)" — optional. |

## Proposed README diff (APPLIED 2026-07-10 with approval — R1, R6, R15, R18, R26, R34)

```diff
-**One shared brain for your team's AI coding agents.**
-Git-native memory that Claude Code, Cursor, and Codex read from and write to —
+**One shared brain for your team's AI coding agents.**
+Git-native memory that Claude Code, Cursor, and any MCP-capable agent read from and write to —

-This isn't just annoying, it's expensive: re-sent and re-explored context is
-the dominant share of agentic token spend, and hand-maintained CLAUDE.md /
+This isn't just annoying, it's expensive: re-sent and re-explored context is
+a large share of agentic token spend, and hand-maintained CLAUDE.md /

-tb init                    # imports CLAUDE.md/.cursorrules/AGENTS.md/ADRs → opens a PR
+tb init                    # imports CLAUDE.md/.cursorrules/AGENTS.md/ADRs → PR-ready branch

-Next Claude Code session prints: `Loaded 47 team memories.` That's it.
+Your next Claude Code session starts with the team's memories injected as
+context (silently — run `tb doctor` to confirm the daemon is serving). That's it.

-written; the redaction test corpus is public and release-gating.
+written; the redaction test corpus is public and gates CI.

-v1. Claude Code fully supported; Cursor capture in progress (context serving
-already works via MCP); Codex/Kiro adapters next. macOS/Linux, Windows via WSL.
+v1. Claude Code fully supported; Cursor supported with degraded capture (no
+edit/command telemetry — see the matrix above); Codex/Kiro adapters next.
+macOS/Linux, Windows via WSL.
```

Optional (R26, preferred over the README wording change): add `- run: pnpm test`
to release.yml's publish job so "release-gating" becomes literally true — a
separate CI change requiring approval per the audit guardrails.
