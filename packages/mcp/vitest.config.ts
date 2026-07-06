import { defineConfig } from 'vitest/config';

// The mcp suite is integration-heavy: daemon (socket server) and spool tests
// each spawn several git/network subprocesses. Under the full-monorepo run all
// packages' suites execute in parallel, and that subprocess contention can push
// a correct test past vitest's 5s default. Give them realistic headroom — this
// is a slow-under-load accommodation, not a hung-test mask.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
