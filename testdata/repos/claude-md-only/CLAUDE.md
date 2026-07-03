# Acme Billing Service — agent guidelines

Acme Billing handles invoicing and payment reconciliation for the Acme
platform. Work in small commits, keep the changelog current, and prefer
extending existing modules over adding new top-level directories.

## Code style

TypeScript strict mode everywhere; no implicit any. Exported functions
carry explicit return types. Prefer plain functions over classes unless
state is genuinely shared. Format with the repo prettier config and let
the linter settle import order — never hand-sort imports.

## Testing

Run the unit suite before every commit and the contract suite before
merging. New reconciliation logic needs a golden-file test using the
fixtures under fixtures/statements. Flaky tests are quarantined with a
linked ticket, never deleted outright.

## Commit conventions

Use conventional commit prefixes (feat, fix, chore, docs). The subject
line stays under 72 characters and references the invoice-domain ticket
when one exists. Squash-merge feature branches; rebase-merge is reserved
for long-running migration branches.
