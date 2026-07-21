# SESSION-EVENT-1.0

An independently implementable spec for a TeamBrain session event. `docs/internal/
CONTRACTS.md` (C2) is **upstream**; this document and the exported schema are
derived from it.

## File

JSONL, one file per session, on branch `teambrain/sessions`. One event per line.

## Envelope

`{v: 1, sid, t (ISO), tool, model, repo, branch, ev, data}`. The join keys
`sid, repo, branch, tool, model` appear on every event.

## `ev` kinds

- `session_start`
- `intent` — a locally-summarised string, ≤ 200 chars, never a raw prompt
- `memory_retrieved` `{ids[]}`
- `tool_use` `{kind: edit|command|test|explore, path?, exit_code?}`
- `plan_revision`
- `candidate_proposed` `{draft}`
- `session_end` `{outcome: committed|abandoned|unknown, duration_s, turns, commit_shas[]}`

Never records raw prompts, file contents, or diff bodies. Evolution is
additive-only within the major version.
