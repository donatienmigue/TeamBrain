import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeProvider } from '@teambrain/distill';
import { runCodemapCommand } from './codemap-command.js';

// D6: the CLI gate. codemap.enabled=false must refuse (the feature is
// opt-in end to end); enabled=true runs the incremental update offline
// through the fake provider.

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0)
    rmSync(cleanups.pop()!, { recursive: true, force: true });
});

function fixtureRepo(enabled: boolean): string {
  const repo = mkdtempSync(join(tmpdir(), 'tb-codemap-cli-'));
  cleanups.push(repo);
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, '.teambrain'), { recursive: true });
  writeFileSync(
    join(repo, '.teambrain', 'brain.yaml'),
    `version: 1\ncodemap:\n  enabled: ${enabled}\n`,
  );
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'main.ts'), 'export const x = 1;\n');
  return repo;
}

const provider = fakeProvider(() => ({ summary: 'A summary.' }));

describe('tb distill --codemap (D6)', () => {
  it('negative: refuses when codemap.enabled is false (exit 1)', async () => {
    const repo = fixtureRepo(false);
    const result = await runCodemapCommand(repo, { provider });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('codemap.enabled: true');
  });

  it('runs the incremental update when enabled', async () => {
    const repo = fixtureRepo(true);
    const first = await runCodemapCommand(repo, { provider });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('1 summarized, 0 unchanged, 0 removed');

    const second = await runCodemapCommand(repo, { provider });
    expect(second.output).toContain('0 summarized, 1 unchanged, 0 removed');
  });
});
