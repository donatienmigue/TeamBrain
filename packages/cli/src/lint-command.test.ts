import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// R1 (field report 001): `tb lint .` from a repo root reported the brain.yaml
// schema violation instead of resolving into .teambrain/. A wrong path is a C6
// user error (exit 1), not a lint failure (exit 3).
describe('runLintCommand brain directory resolution (R1)', () => {
  function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'tb-lint-r1-'));
  }

  it('A1: resolves a repo root to its .teambrain/ brain', () => {
    const root = tempDir();
    cpSync(VALID_BRAIN_DIR, join(root, '.teambrain'), { recursive: true });

    const result = runLintCommand(root);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('6 memory file(s) checked');
    expect(result.output).toContain('.teambrain');
  });

  it('A2: emits no resolution note when the brain dir is passed directly', () => {
    const result = runLintCommand(VALID_BRAIN_DIR);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('linting');
  });

  it('A3: still reports the schema violation when brain.yaml is deleted', () => {
    const brain = tempDir();
    cpSync(join(VALID_BRAIN_DIR, 'memories'), join(brain, 'memories'), {
      recursive: true,
    });

    const result = runLintCommand(brain);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('[schema]');
    expect(result.output).toContain('brain.yaml is missing');
  });

  it('A4: exits 1 with "no brain found" on a directory with no brain', () => {
    const empty = tempDir();

    const result = runLintCommand(empty);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('no brain found');
    expect(result.output).not.toContain('[schema]');
  });

  it('A4b: retired/ alone is still a brain, not a wrong path', () => {
    const brain = tempDir();
    mkdirSync(join(brain, 'retired'));

    const result = runLintCommand(brain);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('brain.yaml is missing');
  });

  it('A5: single-file mode is untouched by resolution', () => {
    const cleanFile = join(
      VALID_BRAIN_DIR,
      'memories',
      'decisions',
      '01J8YC01A2B3C4D5E6F7G8H9J0-adopt-pnpm-workspaces-for-the-monorepo.md',
    );
    expect(runLintCommand(cleanFile)).toEqual({
      exitCode: 0,
      output: 'tb lint: 1 memory file(s) checked, no violations\n',
    });

    const poisonedFile = join(
      POISONED_BRAIN_DIR,
      'memories',
      'decisions',
      '01J8YD9AK1M2N3P4Q5R6S7T8V9-vitest-fake-timers-flake-on-ci.md',
    );
    const poisoned = runLintCommand(poisonedFile);
    expect(poisoned.exitCode).toBe(3);
    expect(poisoned.output).not.toContain('linting');
  });

  it('prefers brain.yaml at the given path over a nested .teambrain/', () => {
    const root = tempDir();
    cpSync(VALID_BRAIN_DIR, root, { recursive: true });
    cpSync(VALID_BRAIN_DIR, join(root, '.teambrain'), { recursive: true });

    const result = runLintCommand(root);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('linting');
  });
});
