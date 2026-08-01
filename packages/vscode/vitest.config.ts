import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The extension host is the only place a real `vscode` module exists, so the
// activation tests run against a stub that records what the extension asked
// the host to do. Everything else in the package is pure and needs no stub.
export default defineConfig({
  test: {
    alias: {
      vscode: fileURLToPath(
        new URL('./src/testing/vscode-stub.ts', import.meta.url),
      ),
    },
  },
});
