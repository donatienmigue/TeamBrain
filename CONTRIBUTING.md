# Contributing to TeamBrain

## Local setup

Requirements: Node >= 20, [pnpm](https://pnpm.io). The `gh` CLI (authenticated)
is needed once you're working on milestones that automate pull requests
(brain import, distiller, digest) — not required for the current scaffold.

```
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm bench
```

A `Stop` hook (`.claude/settings.json`) runs `pnpm test:changed` at the end
of every Claude Code turn in this repo, so a turn can't end with failing
tests.

## Engineering docs

This project is being built milestone-by-milestone, with heavy Claude Code
assistance. Whether you're a human or an AI agent picking up work here,
read in this order:

- [`CLAUDE.md`](CLAUDE.md) — non-negotiable engineering principles, the fixed
  stack, testing rules, and the definition of done. Applies to every
  contributor, human or AI.
- [`docs/internal/CONTRACTS.md`](docs/internal/CONTRACTS.md) — frozen v1
  schemas and interfaces. Authoritative; don't change these without raising
  it first.
- [`docs/internal/BUILD_PLAN.md`](docs/internal/BUILD_PLAN.md) — the
  milestone-by-milestone task list (M0–M8) with acceptance criteria.
- [`docs/internal/TECH_BRIEF.md`](docs/internal/TECH_BRIEF.md) — the full
  architecture and design-decision brief the plan above is derived from
  (reference only; CONTRACTS.md wins on conflict).
- [`docs/internal/KICKOFF_PROMPTS.md`](docs/internal/KICKOFF_PROMPTS.md) —
  the prompts used to start each milestone session and to run a hostile
  review after each one lands.
- [`docs/internal/DEVLOG.md`](docs/internal/DEVLOG.md) — a running log of
  completed tasks: what changed, why, and the tradeoffs made.

## Conventions

- One task per commit, matching the tasks in `docs/internal/BUILD_PLAN.md`.
- Each commit that adds a dependency justifies it in the commit body (see
  `CLAUDE.md` §"Boring dependencies").
- After a milestone's Accept criteria are all green, it gets tagged `m<N>`.
- Don't touch another package's internals except through its public
  interface.

## License

By contributing, you agree your contributions are licensed under the
project's [Apache-2.0 license](LICENSE).
