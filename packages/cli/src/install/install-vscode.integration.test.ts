import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInstallCommand } from './install-command.js';

// `tb install vscode` is the manual fallback for the VS Code path (the
// extension registers the same server programmatically). It must converge in
// one run, and it must write VS Code's config shape — a `.vscode/mcp.json`
// using Claude's `mcpServers` key would be silently ignored by VS Code.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-install-vscode-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb install vscode', () => {
  it('writes VS Code’s config shape and a second run is a zero-diff no-op', async () => {
    const dir = await tempProject();
    const mcpPath = join(dir, '.vscode', 'mcp.json');
    const instructionsPath = join(
      dir,
      '.github',
      'instructions',
      'teambrain.instructions.md',
    );

    const first = await runInstallCommand('vscode', dir, { yes: true });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('Installed TeamBrain for vscode');

    const config = JSON.parse(await readFile(mcpPath, 'utf8'));
    expect(config.servers.teambrain).toEqual({
      type: 'stdio',
      command: 'tb',
      args: ['mcp', '${workspaceFolder}', '--client', 'vscode'],
    });
    expect(config.mcpServers).toBeUndefined();
    expect(await readFile(instructionsPath, 'utf8')).toContain(
      'mcp__teambrain__memory_context',
    );

    const mcpAfterFirst = await readFile(mcpPath, 'utf8');
    const second = await runInstallCommand('vscode', dir, { yes: true });
    expect(second.output).toContain('already installed');
    expect(await readFile(mcpPath, 'utf8')).toBe(mcpAfterFirst);
  });

  it('merges into an existing .vscode/mcp.json without dropping other servers', async () => {
    const dir = await tempProject();
    await mkdir(join(dir, '.vscode'), { recursive: true });
    await writeFile(
      join(dir, '.vscode', 'mcp.json'),
      JSON.stringify(
        { servers: { github: { type: 'http', url: 'https://example' } } },
        null,
        2,
      ),
      'utf8',
    );

    await runInstallCommand('vscode', dir, { yes: true });
    const config = JSON.parse(
      await readFile(join(dir, '.vscode', 'mcp.json'), 'utf8'),
    );
    expect(config.servers.github).toEqual({
      type: 'http',
      url: 'https://example',
    });
    expect(config.servers.teambrain).toBeDefined();
  });

  it('lists vscode among the supported tools on an unknown tool', async () => {
    const dir = await tempProject();
    const result = await runInstallCommand('vs-code', dir, { yes: true });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('vscode');
  });
});
