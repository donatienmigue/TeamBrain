import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInstallCommand } from './install-command.js';

// A2 accept: `tb install codex` works idempotently. CODEX_HOME (Codex's own
// config-dir override) keeps the test out of the user's real home directory.

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempCodexHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-codex-'));
  const previous = process.env['CODEX_HOME'];
  process.env['CODEX_HOME'] = dir;
  cleanups.push(() => {
    if (previous === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = previous;
  });
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-codex-proj-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb install codex (A2 accept)', () => {
  it('registers the MCP server in config.toml; second run is a no-op', async () => {
    const codexHome = await tempCodexHome();
    const project = await tempProject();
    const configPath = join(codexHome, 'config.toml');

    const first = await runInstallCommand('codex', project, { yes: true });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('Installed TeamBrain for codex');
    expect(existsSync(configPath)).toBe(true);

    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('[mcp_servers.teambrain]');
    expect(config).toContain('"--client", "codex"');

    const second = await runInstallCommand('codex', project, { yes: true });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('already installed');
    expect(await readFile(configPath, 'utf8')).toBe(config);
  });

  it('appends to an existing config.toml without clobbering it', async () => {
    const codexHome = await tempCodexHome();
    const project = await tempProject();
    const configPath = join(codexHome, 'config.toml');
    await writeFile(configPath, 'model = "gpt-5"\n', 'utf8');

    await runInstallCommand('codex', project, { yes: true });
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('[mcp_servers.teambrain]');
  });
});
