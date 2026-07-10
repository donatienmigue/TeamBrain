import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './index.js';

describe('core', () => {
  it('reports exactly the published package.json version (release smoke gate)', () => {
    const packageJson = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as { version: string };
    expect(CORE_VERSION).toBe(packageJson.version);
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
