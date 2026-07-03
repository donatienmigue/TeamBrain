import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLintCommand } from './lint-command.js';

const BRAINS_DIR = fileURLToPath(
  new URL('../../../testdata/brains', import.meta.url),
);
const VALID_BRAIN_DIR = join(BRAINS_DIR, 'valid');
const POISONED_BRAIN_DIR = join(BRAINS_DIR, 'poisoned');

describe('runLintCommand', () => {
  it('exits 0 on the valid fixture brain', () => {
    const result = runLintCommand(VALID_BRAIN_DIR);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('6 memory file(s) checked');
  });

  it('exits 3 on the poisoned fixture brain, listing every violation', () => {
    const result = runLintCommand(POISONED_BRAIN_DIR);
    expect(result.exitCode).toBe(3);
    const lines = result.output.trimEnd().split('\n');
    // 10 violation lines + 1 summary line.
    expect(lines).toHaveLength(11);
    expect(lines[lines.length - 1]).toContain('10 violation(s)');
    for (const rule of [
      'injection',
      'body',
      'evidence',
      'schema',
      'placement',
    ]) {
      expect(result.output).toContain(`[${rule}]`);
    }
  });

  it('exits 1 when the path does not exist', () => {
    const result = runLintCommand(join(BRAINS_DIR, 'no-such-brain'));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('path not found');
  });

  it('lints a single memory file, applying placement checks', () => {
    const cleanFile = join(
      VALID_BRAIN_DIR,
      'memories',
      'decisions',
      '01J8YC01A2B3C4D5E6F7G8H9J0-adopt-pnpm-workspaces-for-the-monorepo.md',
    );
    expect(runLintCommand(cleanFile).exitCode).toBe(0);

    const poisonedFile = join(
      POISONED_BRAIN_DIR,
      'memories',
      'decisions',
      '01J8YD9AK1M2N3P4Q5R6S7T8V9-vitest-fake-timers-flake-on-ci.md',
    );
    const result = runLintCommand(poisonedFile);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('[placement]');
  });

  it('enforces evidence with requireEvidence', () => {
    const result = runLintCommand(VALID_BRAIN_DIR, { requireEvidence: true });
    expect(result.exitCode).toBe(3);
    // 4 of the 6 valid memories carry no evidence block.
    expect(result.output).toContain('4 violation(s)');
    expect(result.output).toContain('evidence is required');
  });
});
