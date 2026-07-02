import { describe, expect, it } from 'vitest';
import { cliVersion } from './index.js';

describe('cli', () => {
  it('resolves the version from @teambrain/core via workspace linking', () => {
    expect(cliVersion()).toBe('0.0.1');
  });
});
