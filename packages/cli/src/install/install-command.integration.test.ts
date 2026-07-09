import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInstallCommand } from './install-command.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-install-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb install claude-code (M4.3 accept)', () => {
  it('writes both config files, and a second run is a zero-diff no-op', async () => {
    const dir = await tempProject();
    const mcpPath = join(dir, '.mcp.json');
    const settingsPath = join(dir, '.claude', 'settings.json');

    const first = await runInstallCommand('claude-code', dir, { yes: true });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('Installed TeamBrain');
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);

    const mcpAfterFirst = await readFile(mcpPath, 'utf8');
    const settingsAfterFirst = await readFile(settingsPath, 'utf8');

    const second = await runInstallCommand('claude-code', dir, { yes: true });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already installed');
    // Byte-identical: the second run wrote nothing.
    expect(await readFile(mcpPath, 'utf8')).toBe(mcpAfterFirst);
    expect(await readFile(settingsPath, 'utf8')).toBe(settingsAfterFirst);
  });

  it('merges into existing settings without clobbering them', async () => {
    const dir = await tempProject();
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } }, null, 2),
      'utf8',
    );

    await runInstallCommand('claude-code', dir, { yes: true });
    const settings = JSON.parse(
      await readFile(join(dir, '.claude', 'settings.json'), 'utf8'),
    );
    expect(settings.permissions).toEqual({ allow: ['Bash'] });
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('aborts without writing when confirmation is declined', async () => {
    const dir = await tempProject();
    const result = await runInstallCommand('claude-code', dir, {
      confirm: async () => false,
    });
    expect(result.output).toContain('Aborted');
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
  });

  it('rejects an unsupported tool', async () => {
    const dir = await tempProject();
    const result = await runInstallCommand('unknown-tool', dir, { yes: true });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('unsupported tool');
  });

  it('installs cursor specific configurations cleanly and idempotently', async () => {
    const dir = await tempProject();
    const mcpPath = join(dir, '.cursor', 'mcp.json');
    const rulesPath = join(dir, '.cursor', 'rules', 'teambrain.mdc');

    const first = await runInstallCommand('cursor', dir, { yes: true });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('Installed TeamBrain for cursor');
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(rulesPath)).toBe(true);
    
    // Assert cursor is added to mcp.json args
    const mcpContent = JSON.parse(await readFile(mcpPath, 'utf8'));
    expect(mcpContent.mcpServers.teambrain.args).toContain('--client');
    expect(mcpContent.mcpServers.teambrain.args).toContain('cursor');

    const second = await runInstallCommand('cursor', dir, { yes: true });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already installed');
  });

  it('errors on a malformed existing config instead of clobbering it', async () => {
    const dir = await tempProject();
    await writeFile(join(dir, '.mcp.json'), '{ not json', 'utf8');
    const result = await runInstallCommand('claude-code', dir, { yes: true });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('not valid JSON');
  });
});
