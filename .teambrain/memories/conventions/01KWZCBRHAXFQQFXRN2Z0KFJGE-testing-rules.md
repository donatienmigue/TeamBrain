---
id: 01KWZCBRHAXFQQFXRN2Z0KFJGE
class: convention
scope: team
status: active
priority: advisory
title: "Testing rules"
created: 2026-07-07
supersedes: []
tags:
  - imported
  - "source:CLAUDE.md"
ttl_days: null
---

## Testing rules
- Every package has unit tests; every schema in docs/internal/CONTRACTS.md has a zod schema
  with fixture-based round-trip tests.
- Tests never touch the network. LLM calls go through the Provider interface;
  tests use the FakeProvider with recorded fixtures in testdata/.
- Negative tests are first-class: retired memories absent from retrieval;
  user-scope files absent from any pushed tree; redaction corpus is release-gating.
- Performance budgets are tests: pnpm bench fails if retrieval p95 > 300ms on
  the 5k-memory fixture or hook handler > 20ms p95.
