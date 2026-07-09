# Status

This document captures the current state of the M0-M8 build plan execution.

## Task Classifications

| Task | Status | Evidence | Missing / Next Steps |
|---|---|---|---|
| **M0** (Scaffold) | DONE | `pnpm build`, `pnpm lint`, and `pnpm bench` pass. `pnpm test` is fully green after addressing test timeouts. | None |
| **M1** (Core / format) | DONE | `pnpm --filter core test` passes. `tb lint testdata/brains/valid` exits 0. `tb lint testdata/brains/poisoned` exits 3. | None |
| **M2** (tb init importer) | DONE | `src/init/init-command.integration.test.ts` passed 10 integration tests validating all Accept criteria. | None |
| **M3** (Retrieval index) | DONE | `pnpm --filter index test` passed. `pnpm bench` succeeds in <60s with p95 <300ms. | None |
| **M4** (MCP + daemon) | DONE | `daemon.integration.test.ts` passed all hook and MCP tool tests. `install-command.integration.test.ts` passed. | None |
| **M5** (Capture hooks) | DONE | `pnpm --filter redact test` passed (corpus green). Replay test passed (as part of `pnpm test`). | None |
| **M6** (Distiller) | DONE | `pnpm --filter distill test` passes (golden pipeline green, flywheel complete). | None |
| **M7** (Digest, doctor, CI) | DONE | `doctor-command.test.ts` passes with schema validation. `tb digest` tested for structural privacy. Templates pass `actionlint`. | None |
| **M8** (Hardening & release) | DONE | `src/full-loop.integration.test.ts` passed. `npm pack` successfully builds the tarball. `nightly.yml` implemented. | None |
| **Cursor hooks** (Deferred) | DONE | Parity fixture implemented (`raw-cursor.jsonl`). `tb install cursor` tested idempotently. Doctor command explicitly shows degraded telemetry mode. Matrix added to README. | None |

## Continuation Frontier

**V1 Complete**
All milestones M0–M8 and continuation gates C0–C7 have been successfully fulfilled and verified. TeamBrain V1 is complete.
