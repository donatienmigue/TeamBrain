# Kickoff prompts (for the human driving the build)

Paste one per fresh Claude Code session, in plan mode.

**M0:** "Read CLAUDE.md, docs/internal/CONTRACTS.md, and docs/internal/BUILD_PLAN.md M0. Plan then execute M0.1. Keep the dependency tree minimal per the principles; justify each dep in the commit body."
**M1–M8 (template):** "Read CLAUDE.md and docs/internal/CONTRACTS.md fully, then docs/internal/BUILD_PLAN.md milestone M<N>. Confirm all prior milestones' Accept commands are green (`pnpm test && pnpm bench`), then plan M<N> task by task. Flag any contract ambiguity BEFORE coding instead of improvising. Execute one task per commit; update docs/internal/DEVLOG.md per task. Do not touch files owned by other packages except through their public interfaces."
**Review prompt (after each milestone, fresh session):** "Act as a hostile reviewer of the last milestone's diff (git log/diff since tag m<N-1>). Check: contract violations vs docs/internal/CONTRACTS.md, principle violations vs CLAUDE.md (especially privacy §3 and degradation §2), missing negative tests, dependency creep. Output a findings list ranked by severity; fix only what I approve."
