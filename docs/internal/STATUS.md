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
| **M6** (Distiller) | PARTIAL | Fails during `pnpm test` in `src/sessions.integration.test.ts` (2 tests timed out). | Fix the timeouts in the distiller's gitSessionSource integration tests. |
| **M7** (Digest, doctor, CI) | PARTIAL | `doctor-command.test.ts` passed. | `actionlint` is not installed/run on the templates, leaving the template validation incomplete. |
| **M8** (Hardening & release) | DONE | `src/full-loop.integration.test.ts` passed. `npm pack` successfully builds the tarball. | None |
| **Cursor hooks** (Deferred) | NOT STARTED | `packages/hooks/src/` contains no `cursor/` folder or stub implementations. | Execute C6 spike and implement the cursor capture. |

## Continuation Frontier

**C4 — Complete the distiller → memory-PR**
With C1 fully verified and M0 testing pipelines running green, the immediate continuation frontier is now **C4**, which involves resolving the remaining distiller (M6) test timeout gaps.
