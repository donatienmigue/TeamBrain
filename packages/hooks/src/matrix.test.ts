import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CaptureAdapter } from './adapter.js';
import { MATRIX_END, MATRIX_START, renderCaptureMatrix } from './matrix.js';
import { ADAPTERS, supportedTools } from './registry.js';

// A0.4 the anti-overclaim test: the README's capture matrix must equal the
// table generated from ADAPTERS[*].capabilities. If this fails, the README
// claims capture the adapters don't declare (or vice versa) — regenerate with
// `node scripts/update-capture-matrix.mjs` after `pnpm build`.

const here = dirname(fileURLToPath(import.meta.url));

describe('anti-overclaim matrix (A0.4)', () => {
  it('README.md matrix matches the capabilities declared in code', () => {
    const readmePath = join(here, '..', '..', '..', 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    const startIndex = readme.indexOf(MATRIX_START);
    const endIndex = readme.indexOf(MATRIX_END);

    expect(startIndex).toBeGreaterThan(-1);
    expect(endIndex).toBeGreaterThan(startIndex);

    const actualTable = readme
      .substring(startIndex + MATRIX_START.length, endIndex)
      .trim()
      .replace(/\r\n/g, '\n');

    const adapters = supportedTools().map((t) => ADAPTERS[t] as CaptureAdapter);
    const expectedTable = renderCaptureMatrix(adapters).replace(/\r\n/g, '\n');

    expect(actualTable).toBe(expectedTable);
  });

  it('a new adapter needs only its file + a registry entry (A0 accept demo)', () => {
    // A throwaway stub — never registered in main. Its matrix column derives
    // entirely from the declared capabilities, so shipping a real vendor is:
    // write the adapter file, add it to ADAPTERS. Nothing else.
    const stub: CaptureAdapter = {
      tool: 'stub-tool',
      displayName: 'Stub Tool',
      tier: 'serving-only',
      capabilities: {
        sessionStart: false,
        sessionEnd: false,
        toolUse: false,
        commitShas: false,
        planRevision: false,
      },
      mapEvent: () => null,
      installPlan: () => [],
      describeDegradation: () => 'serving only',
    };
    const table = renderCaptureMatrix([
      ...supportedTools().map((t) => ADAPTERS[t] as CaptureAdapter),
      stub,
    ]);
    expect(table).toContain('Stub Tool');
    expect(table).toContain('`tb install stub-tool`');
    expect(table).toContain('Serving only');
  });
});
