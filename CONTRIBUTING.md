# Contributing to TeamBrain

**New here? Start with [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** — setup in
5 minutes, a repo map, the 60-second architecture, test/bench recipes, recipes
for the most common changes, and troubleshooting. This file covers policy and
reading order; that one covers how to actually get things done.

## Local setup

Requirements: Node >= 20, [pnpm](https://pnpm.io) (`corepack enable`). The
`gh` CLI (authenticated) is only needed for the PR-opening paths (distiller,
digest, init against a real remote).

```
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm bench
```

All four are CI gates — green before and after your change.

A `Stop` hook (`.claude/settings.json`) runs `pnpm test:changed` at the end
of every Claude Code turn in this repo, so a turn can't end with failing
tests. The repo also dogfoods TeamBrain on itself — see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#dogfooding-this-repo-runs-teambrain-on-itself).

## Releases (Changesets)

Versioning and npm publishing are automated with
[Changesets](https://github.com/changesets/changesets). **Any change that
touches a published `@teambrain/*` package needs a changeset:**

```
pnpm changeset      # pick the bump (patch/minor/major) + write a summary
```

Commit the generated `.changeset/*.md` file with your PR. All `@teambrain/*`
packages are versioned in lockstep (`fixed`), so one changeset bumps them all.

On merge to `main`, the `changesets` workflow opens (or updates) a **"Version
Packages" PR** that consumes the pending changesets and bumps versions. Merging
*that* PR publishes the new versions to npm (`pnpm -r publish`, which rewrites
`workspace:*` and skips already-published versions). Standalone binaries still
come from a manual `v*` tag via `release.yml`.

## Good first contributions

- **Redaction corpus cases** (`packages/redact/corpus/`) — adversarial true
  positives and tricky negatives are always welcome, and the corpus is
  release-gating so every case has teeth.
- **Injection-lint patterns** (`packages/core/src/injection-patterns.ts`) —
  each new pattern ships with one positive and one negative test.
- Low-severity findings in [docs/internal/AUDIT.md](docs/internal/AUDIT.md)
  are pre-triaged, scoped work items.

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

- One task per commit, matching the tasks in `docs/internal/BUILD_PLAN.md`
  (or an AUDIT.md finding ID); append a ≤5-line DEVLOG entry per task.
- Every new capability ships a negative test (see the testing rules in
  `CLAUDE.md`); schemas in `docs/internal/CONTRACTS.md` are frozen — propose
  in the DEVLOG and ask before touching them.
- Each commit that adds a dependency justifies it in the commit body (see
  `CLAUDE.md` §"Boring dependencies").
- After a milestone's Accept criteria are all green, it gets tagged `m<N>`.
- Don't touch another package's internals except through its public
  interface.

## License

By contributing, you agree your contributions are licensed under the
project's [Apache-2.0 license](LICENSE).
