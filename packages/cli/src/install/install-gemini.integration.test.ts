import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInstallCommand } from './install-command.js';

// A4 accept: `tb install gemini-cli` converges in a single run — the MCP
// server and the capture hooks land in .gemini/settings.json together
// (regression test for the two-plans-one-path clobber found in review).

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-gemini-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb install gemini-cli (A4 accept)', () => {
  it('one run writes MCP server AND hooks; second run is a zero-diff no-op', async () => {
    const dir = await tempProject();
    const settingsPath = join(dir, '.gemini', 'settings.json');

    const first = await runInstallCommand('gemini-cli', dir, { yes: true });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('Installed TeamBrain for gemini-cli');
    expect(existsSync(settingsPath)).toBe(true);

    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw) as {
      mcpServers: Record<string, { args: string[] }>;
      hooks: Record<string, unknown>;
    };
    // Both merges landed in the single first run.
    expect(settings.mcpServers['teambrain']).toBeDefined();
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'AfterTool',
      'SessionEnd',
      'SessionStart',
    ]);
    expect(raw).toContain('--tool gemini-cli');

    const second = await runInstallCommand('gemini-cli', dir, { yes: true });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already installed');
    expect(await readFile(settingsPath, 'utf8')).toBe(raw);
  });

  it('errors on malformed existing settings instead of clobbering', async () => {
    const dir = await tempProject();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, '.gemini'), { recursive: true });
    await writeFile(
      join(dir, '.gemini', 'settings.json'),
      '{ not json',
      'utf8',
    );

    const result = await runInstallCommand('gemini-cli', dir, { yes: true });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not valid JSON');
    expect(await readFile(join(dir, '.gemini', 'settings.json'), 'utf8')).toBe(
      '{ not json',
    );
  });

  it('unknown tool error lists every registry adapter', async () => {
    const dir = await tempProject();
    const result = await runInstallCommand('nope', dir, { yes: true });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('claude-code, codex, cursor, gemini-cli');
  });
});
