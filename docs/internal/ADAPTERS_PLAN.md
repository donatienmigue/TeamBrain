# ADAPTERS_PLAN — Multi-Vendor Capture Adapters

Companion to the Multi-Vendor Capture Adapters Technical Brief (authoritative
on design). `CLAUDE.md` and `docs/internal/CONTRACTS.md` remain authoritative
on everything else. One milestone per fresh session.

## A0 — The framework (2–3 days) — do this first, it's the whole point

- **A0.1** Define in `packages/hooks/src/adapter.ts`: `CaptureTier`,
  `CaptureCapabilities`, `CaptureAdapter` (per the Technical Brief §3.1:
  `tool`, `tier`, `capabilities`, `mapEvent(raw, ctx)`,
  `installPlan(projectDir)`, `describeDegradation()`).
- **A0.2** Refactor **Claude Code** and **Cursor** into adapters implementing
  it, moving their vendor-specific bits (tool-name taxonomy, install targets)
  into the adapter and leaving envelope/redaction/transport/session-state in
  the shared path. **Zero behavior change: existing tests pass untouched.**
- **A0.3** `packages/hooks/src/registry.ts` — `ADAPTERS: Record<string,
  CaptureAdapter>`. Rewrite `tb install <tool>` to resolve from the registry
  (delete the hardcoded branch). Unknown tool → exit 1 listing supported tools
  (existing test stays green).
- **A0.4 The anti-overclaim test.** A test that derives the capture matrix
  from `ADAPTERS[*].capabilities` and asserts the README's matrix table
  matches it. Wire it into CI. (Optionally generate the table.)
- **A0.5** `tb doctor` reports each installed tool's capture level from
  `capabilities`/`describeDegradation()`, with a test asserting doctor's
  output matches the declared capabilities.

Accept: `pnpm build && pnpm test && pnpm test:integration && pnpm bench` all
green **with no edits to existing hook/install tests**; matrix test green;
adding a hypothetical adapter requires touching only `registry.ts` + the new
adapter file (demonstrate with a throwaway stub in a test, not in `main`).

## A1 — Spikes (≤1 day each; 5 total; can run before A2+)

For **each** of Codex, Cline, Gemini CLI, Kiro, Antigravity, answer one
question against the **actually installed tool** (not the docs): *does it
expose a lifecycle/tool hook that can run a command?*

- If **yes → Tier A** (native hooks): record the hook config format and the
  payload shape; capture a real session's payloads into
  `testdata/sessions/raw-<tool>.jsonl`.
- If **no → Tier B** (MCP-side inference, reuse Cursor's machinery via
  `tb mcp --client <tool>`): record the MCP config location and confirm the
  client connects.
- Special case: for **Kiro**, investigate whether **ACP (Agent Client
  Protocol)** exposes richer lifecycle events than MCP — if so, note whether
  ACP is a *general* Tier-A pathway reusable across future agents (OQ-A1).

Each spike ends with a DEVLOG memo: tier decision, install target, payload
fixture path (or why none), and the resulting `CaptureCapabilities`.
Accept: five memos; a recorded fixture for every Tier-A vendor; capability
declarations ready.
**If a tool cannot be installed/run here: say so explicitly, mark it BLOCKED,
and skip it — do not build a mapper against imagined payloads.**

## A2 — Codex adapter (1–2 days) — highest priority

Fixes README_AUDIT finding **R1** (the tagline currently names Codex though
`tb install codex` errors). Build per its spike tier. Ship the full
per-adapter test set (§D). Update the README matrix (generated) and flip R1's
audit verdict to TRUE with evidence.
Accept: `tb install codex` works idempotently; fixture replay → C2-valid,
privacy-clean events; doctor honest; matrix test green.

## A3 — Cline adapter (1–2 days)

As A2. (MCP-native; plausible Tier A — follow the spike.)

## A4 — Gemini CLI adapter (1–2 days)

As A2.

## A5 — Kiro adapter (1–2 days)

As A2, plus resolve OQ-A1 (ACP as a general pathway) in DEVLOG.

## A6 — Antigravity adapter (1–2 days)

As A2. (Assume Tier B unless the spike says otherwise.)

## A7 — Honesty pass (½ day)

README matrix regenerated from code; `tb doctor` messages verified;
**README_AUDIT R1 → TRUE**; update the site/launch copy to the accurate
serving-vs-capture split ("reads from any MCP-capable agent … capture ships
for X, Y, Z").
Accept: matrix test green; no claim in README/site exceeds what
`capabilities` declares.

## D. Per-adapter test set (every adapter, non-negotiable)

1. **Mapping units** against the recorded real fixture
   (`testdata/sessions/raw-<tool>.jsonl`).
2. **Privacy negative:** replay fixture → assert no event contains
   `content|old_string|new_string|prompt|command` keys and no un-redacted
   corpus string appears.
3. **C2 validity:** every event validates against `sessionEventSchema` with
   all join keys (`sid/repo/branch/tool/model`) present and non-empty.
4. **Idempotent install:** run twice → zero diff; malformed existing config →
   exit 1 without clobbering.
5. **Latency:** handler <20ms p95.
6. **Doctor honesty:** reported capture level == declared `capabilities`.
7. **Matrix:** README table matches `capabilities` (the A0.4 test covers this
   globally).

## Scope-reduction option (consider before A2 — genuinely)

OQ-A3 from the brief: if most vendors land in Tier B, a single generic
`tb install mcp --client <name>` (Tier-B by default for *any* MCP client) may
deliver ~80% of the value in ~20% of the time. Recommended path: do
**A0 + A1 (spikes) + A2 (Codex)**, then *decide* — build the generic Tier-B
adapter, or continue per-vendor Tier-A adapters only where a spike proved
native hooks exist and a user actually asked.
