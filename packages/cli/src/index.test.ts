import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cliVersion } from './index.js';

describe('cli', () => {
  it('reports the CLI package.json version (release smoke gate: tb --version === tag)', () => {
    const packageJson = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as { version: string };
    // cliVersion comes from @teambrain/core; the packages version in
    // lockstep, so it must equal this package's own published version.
    expect(cliVersion()).toBe(packageJson.version);
  });
});
