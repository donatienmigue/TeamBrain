import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('hooks', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@teambrain/hooks');
  });
});
