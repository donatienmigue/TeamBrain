import { defineConfig } from 'vitest/config';

// Several cli suites (`tb init`, `tb distill`) drive git worktrees through
// subprocesses; under the parallel full-monorepo run that contention can push a
// correct test past vitest's 5s default. Give them realistic headroom.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
