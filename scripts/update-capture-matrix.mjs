#!/usr/bin/env node
// Regenerates the README capture matrix from ADAPTERS[*].capabilities.
// Run after `pnpm build`; the matrix test (packages/hooks/src/matrix.test.ts)
// fails CI whenever the README disagrees with this output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = await import(
  new URL(
    `file://${join(root, 'packages', 'hooks', 'dist', 'index.js').replaceAll('\\', '/')}`,
  )
);
const {
  ADAPTERS,
  supportedTools,
  renderCaptureMatrix,
  MATRIX_START,
  MATRIX_END,
} = hooks;

const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const start = readme.indexOf(MATRIX_START);
const end = readme.indexOf(MATRIX_END);
if (start === -1 || end === -1) {
  console.error('README.md is missing the capture-matrix markers');
  process.exit(1);
}

const table = renderCaptureMatrix(supportedTools().map((t) => ADAPTERS[t]));
const updated =
  readme.slice(0, start + MATRIX_START.length) +
  '\n' +
  table +
  '\n' +
  readme.slice(end);
if (updated === readme) {
  console.log('capture matrix already up to date');
} else {
  writeFileSync(readmePath, updated, 'utf8');
  console.log('README.md capture matrix regenerated');
}
