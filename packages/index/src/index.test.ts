import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('index', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@teambrain/index');
  });
});
