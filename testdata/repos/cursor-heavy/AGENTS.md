# Agent notes for Northwind

The storefront deploys from main on every merge; there is no staging
freeze, so a broken main blocks the whole team. Verify locally before
pushing.

## Build commands

pnpm dev starts the storefront against the shared dev API. pnpm build
must pass with zero type errors before any PR. pnpm test runs vitest;
pnpm e2e runs Playwright headless and needs Docker for the database.

## Code review expectations

Every PR needs one approval from the owning squad. Screenshots are
required for visual changes. Keep PRs under 400 changed lines where
possible; split refactors from behavior changes into separate PRs.
