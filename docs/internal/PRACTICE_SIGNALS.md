# Practice signals — is metadata enough for FlightDeck? (D3.2 / OQ-7)

Verdict up front: **conditional GO.** The metadata-only C2 event stream
supports a first, honest FlightDeck built on team-level practice aggregates —
but three of the signals the product brief imagines are currently thin or
absent, and one (plan revisions) is not emitted by any capture path at all.
FlightDeck should be scoped to what the table below marks *strong* until real
usage data says the thin signals matter.

## What FlightDeck needs vs. what metadata provides

FlightDeck's thesis: a team lead can see *how agent-assisted development is
going* — friction, waste, memory leverage — without anyone's prompts, diffs,
or per-person stats. From C2 events only (`session_start`, `intent`,
`memory_retrieved`, `tool_use {kind, path?, exit_code?}`, `plan_revision`,
`candidate_proposed`, `session_end {outcome, duration_s, turns, commit_shas}`),
the digest now computes (packages/cli/src/digest/practice-signals.ts, D3.2):

| Signal | Definition (exact) | Strength today |
| --- | --- | --- |
| Outcome mix | `session_end.outcome` counts: committed / abandoned / unknown | **Strong** — direct field; Claude Code sets it from the commit heuristic |
| Retries/session | command/test `tool_use` following a *failed* (`exit_code≠0`) `tool_use` of the same kind | **Strong** — needs only kind + exit_code |
| Failed commands/session | `tool_use` with `exit_code ≠ 0` | **Strong** |
| Retrieval rate | sessions with ≥1 non-empty `memory_retrieved` / all sessions (G1) | **Strong** |
| Retrieval→outcome co-occurrence | outcome mix split by retrieved vs not | **Strong mechanically, weak causally** — co-occurrence only; no controls; small teams = small n. Present it as correlation, never as "memories cause commits" |
| No-hit searches | `memory_retrieved` with empty `ids` | **Strong** — the documentation-gap signal |
| Governance friction | median proposal-PR time-to-merge via `gh pr list` (D3.1) | **Strong** — from the forge, not from capture |
| Context-setup effort (G2) | events before the first `tool_use` per session | **Thin** — a proxy. Metadata cannot see "turns spent pasting context"; it sees event counts. Directionally useful, not a headline number |
| Plan revisions/session | `plan_revision` count | **Absent in practice** — C2 defines the event but *no capture path emits it* (Claude Code hooks expose no plan signal; Cursor capture is MCP-inference only). The aggregate is wired and will light up if a source appears |
| Duration/turns distributions | `session_end` fields | **Medium** — Claude Code real; Cursor idle-inferred ends have `outcome:'unknown'` and no commits, so mixed-tool teams skew toward unknown |

## Why this is a GO

1. Six signals are strong with zero new capture and zero privacy cost — they
   are already aggregate-only by construction (people-free negative test in
   practice-signals.test.ts; the digest never sees sid/tool/model/repo).
2. The two product goals this phase actually needs — G1 (memory value:
   retrieval rate, no-hit gaps, co-occurrence) and G2 (governance friction:
   time-to-merge) — sit entirely in the strong column.
3. The weak signals fail *soft*: they render as thinner numbers, not wrong
   ones, and every definition above is honest about what it measures.

## The conditions on the GO

- **Do not build FlightDeck features on plan_revision** until some capture
  path emits it (candidate: a Claude Code PostToolUse mapper for plan-mode
  tools, if/when the hook surface exposes one). Track as a D-phase follow-up.
- **Label co-occurrence as correlation** in every surface. With <100
  sessions/week the split table is anecdote, not evidence; show n.
- **Cursor sessions dilute outcome quality** (always `unknown`, no commits).
  If Cursor usage dominates a team, outcome mix must be presented per-tool —
  which the digest cannot do today *by design* (the aggregator drops `tool`).
  If dogfooding shows this matters, the fix is a per-tool session count
  (still people-free) — a deliberate, reviewed widening, not a default.
- **No content capture, ever, to strengthen a signal.** If a signal stays
  thin, the answer is a better metadata source or dropping the signal.

## Bottom line

Metadata is sufficient for a FlightDeck v1 scoped to: outcome mix, retry and
failure friction, memory leverage (retrieval rate, no-hit gaps,
labeled co-occurrence), and governance friction. It is *not* sufficient for
plan-quality signals or per-person anything — the former for lack of a
source, the latter by construction, permanently. Build to that scope.
