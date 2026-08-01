#!/usr/bin/env node
// Bundles the extension into a single CommonJS file for the VS Code extension
// host. Two constraints drive every option here:
//   - the host `require()`s the entry point, so the output is CJS even though
//     the sources are ESM (`.cjs` so Node ignores the package's "type":
//     "module"); and
//   - `vscode` is provided by the host and must never be bundled.
// The result is pure JavaScript: no native modules, so no platform-specific
// VSIX matrix and no Electron ABI mismatch. Retrieval stays in the `tb` child
// process where better-sqlite3 was built for the right Node ABI.
import { build } from 'esbuild';

const production = process.argv.includes('--production');

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
