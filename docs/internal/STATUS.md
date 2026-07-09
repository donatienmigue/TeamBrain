# Status

This document captures the current state of the M0-M8 build plan execution.

## Task Classifications

| Task | Status | Evidence | Missing / Next Steps |
|---|---|---|---|
| **M0** (Scaffold) | PARTIAL | `pnpm build` and `pnpm bench` pass. `pnpm test` fails in M6.1. `pnpm lint` fails on `.mcp.json` formatting. | Fix Prettier formatting in `.mcp.json`. |
| **M1** (Core / format) | PARTIAL | `pnpm --filter core test` passes. `tb lint testdata/brains/valid` exits 0. | `tb lint testdata/brains/poisoned` exits 1 instead of the expected 3. Must fix the exit code. |
| **M2** (tb init importer) | DONE | `src/init/init-command.integration.test.ts` passed 10 integration tests validating all Accept criteria. | None |
| **M3** (Retrieval index) | DONE | `pnpm --filter index test` passed. `pnpm bench` succeeds in <60s with p95 <300ms. | None |
| **M4** (MCP + daemon) | DONE | `daemon.integration.test.ts` passed all hook and MCP tool tests. `install-command.integration.test.ts` passed. | None |
| **M5** (Capture hooks) | DONE | `pnpm --filter redact test` passed (corpus green). Replay test passed (as part of `pnpm test`). | None |
| **M6** (Distiller) | PARTIAL | Fails during `pnpm test` in `src/sessions.integration.test.ts` (2 tests timed out). | Fix the timeouts in the distiller's gitSessionSource integration tests. |
| **M7** (Digest, doctor, CI) | PARTIAL | `doctor-command.test.ts` passed. | `actionlint` is not installed/run on the templates, leaving the template validation incomplete. |
| **M8** (Hardening & release) | DONE | `src/full-loop.integration.test.ts` passed. `npm pack` successfully builds the tarball. | None |
| **Cursor hooks** (Deferred) | NOT STARTED | `packages/hooks/src/` contains no `cursor/` folder or stub implementations. | Execute C6 spike and implement the cursor capture. |

## Continuation Frontier

**C1 — Complete the core loop to first-value**
The immediate continuation frontier is **C1**, which involves fixing the M1 gap (`tb lint testdata/brains/poisoned` exiting with 1 instead of 3). Before proceeding to feature work, the M0 gaps (`pnpm lint` formatting and M6 test timeouts) should be addressed to get a fully green baseline test suite.
