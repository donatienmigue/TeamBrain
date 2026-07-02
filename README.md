# TeamBrain V1 — Repo Starter

This starter contains everything Claude Code needs to build TeamBrain V1.

## Contents
- `CLAUDE.md` — project principles, stack, testing rules, definition of done (read by Claude Code automatically)
- `.claude/settings.json` — Stop-gate hook: Claude Code cannot end a turn with failing tests
- `docs/CONTRACTS.md` — frozen v1 schemas and interfaces (authoritative)
- `docs/BUILD_PLAN.md` — milestones M0–M8 with acceptance commands + standing guardrails
- `docs/KICKOFF_PROMPTS.md` — the prompt to paste at the start of each milestone session
- `docs/DEVLOG.md` — empty; Claude Code appends one entry per task

## Setup (5 minutes)
1. `git init teambrain && cd teambrain` — copy these files in, commit as `chore: repo starter`.
2. Optionally add the Technical Brief as `docs/TECH_BRIEF.md` (reference only; CONTRACTS.md wins on conflict).
3. Requirements on your machine: Node >= 20, pnpm, gh CLI authenticated, jq (used by the Stop-gate hook).
4. Note: the Stop-gate references `pnpm test:changed` — M0.1 must wire that script (it does, per the plan).
5. Start a Claude Code session in the repo, enter plan mode, paste the M0 prompt from `docs/KICKOFF_PROMPTS.md`.

## Operating rhythm
One milestone per fresh session -> review the diff yourself -> run the hostile-review prompt in a separate session -> tag `m<N>` -> next milestone. Before M5, run the Cursor hook-parity spike (OQ-1 in the Technical Brief); its outcome shapes the M5 adapter interface.
