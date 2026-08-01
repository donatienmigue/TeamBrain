import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscodeStub from './testing/vscode-stub.js';
import { activate, deactivate } from './extension.js';

// Activation tests against the stub host. These cover the two branches that
// decide whether the extension does anything at all: a genuine VS Code (where
// it registers servers) and a fork without the registration API (where it must
// degrade visibly instead of throwing).

const { state, resetStub, setMcpRegistrationSupport } = vscodeStub;

const cleanups: Array<() => Promise<void>> = [];

interface FakeContext {
  subscriptions: Array<{ dispose(): void }>;
}

function context(): FakeContext {
  return { subscriptions: [] };
}

async function repoWithBrain(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-vscode-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.teambrain'), { recursive: true });
  return dir;
}

function openFolder(path: string): void {
  state.workspaceFolders.push({ uri: { scheme: 'file', fsPath: path } });
}

beforeEach(() => {
  resetStub();
  setMcpRegistrationSupport(true);
  // A configured path removes the PATH lookup from these tests; resolution
  // itself is covered exhaustively in cli.test.ts.
  state.configuration['teambrain.cliPath'] = '/usr/local/bin/tb';
});

afterEach(async () => {
  deactivate();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('activate — VS Code with the registration API', () => {
  it('registers a provider under the contributed id and serves the brain', async () => {
    const repo = await repoWithBrain();
    openFolder(repo);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    expect(state.registeredProviders).toHaveLength(1);
    expect(state.registeredProviders[0]?.id).toBe('teambrain.mcp');

    const definitions =
      state.registeredProviders[0]?.provider.provideMcpServerDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].command).toBe('/usr/local/bin/tb');
    expect(definitions[0].args).toEqual(['mcp', repo, '--client', 'vscode']);
    expect(definitions[0].cwd.fsPath).toBe(repo);
  });

  it('shows a healthy status bar item', async () => {
    openFolder(await repoWithBrain());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    const item = state.statusBarItems[0];
    expect(item.shown).toBe(true);
    expect(item.text).toContain('$(check)');
    expect(item.backgroundColor).toBeUndefined();
  });

  it('serves nothing and warns when the workspace has no brain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-vscode-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    openFolder(dir);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    expect(
      state.registeredProviders[0]?.provider.provideMcpServerDefinitions(),
    ).toEqual([]);
    expect(state.statusBarItems[0].text).toContain('$(warning)');
  });

  it('picks up a brain created after activation without a reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-vscode-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    openFolder(dir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    let fired = 0;
    state.registeredProviders[0]?.provider.onDidChangeMcpServerDefinitions(
      () => {
        fired += 1;
      },
    );

    await mkdir(join(dir, '.teambrain'), { recursive: true });
    for (const watcher of state.watchers) {
      for (const listener of watcher.onCreate) listener();
    }

    expect(fired).toBe(1);
    expect(
      state.registeredProviders[0]?.provider.provideMcpServerDefinitions(),
    ).toHaveLength(1);
  });

  it('registers nothing when teambrain.enabled is false', async () => {
    openFolder(await repoWithBrain());
    state.configuration['teambrain.enabled'] = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    expect(
      state.registeredProviders[0]?.provider.provideMcpServerDefinitions(),
    ).toEqual([]);
  });
});

describe('activate — a fork without the registration API', () => {
  it('activates cleanly and registers no provider', async () => {
    setMcpRegistrationSupport(false);
    openFolder(await repoWithBrain());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => activate(context() as any)).not.toThrow();
    expect(state.registeredProviders).toHaveLength(0);
  });

  it('says so in the status bar instead of claiming to be registered', async () => {
    setMcpRegistrationSupport(false);
    openFolder(await repoWithBrain());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    expect(state.statusBarItems[0].text).toContain('$(warning)');
    expect(String(state.statusBarItems[0].tooltip)).toContain(
      'MCP registration API',
    );
  });

  it('writes .vscode/mcp.json on the fallback command', async () => {
    setMcpRegistrationSupport(false);
    const repo = await repoWithBrain();
    openFolder(repo);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    await state.commands.get('teambrain.writeMcpConfig')?.();

    const written = JSON.parse(
      await readFile(join(repo, '.vscode', 'mcp.json'), 'utf8'),
    );
    expect(written.servers.teambrain.args).toEqual([
      'mcp',
      '${workspaceFolder}',
      '--client',
      'vscode',
    ]);
  });

  it('does not clobber an unparsable config; offers the snippet instead', async () => {
    setMcpRegistrationSupport(false);
    const repo = await repoWithBrain();
    openFolder(repo);
    await mkdir(join(repo, '.vscode'), { recursive: true });
    const original = '{\n  // hand-written\n  "servers": {}\n}';
    await writeFile(join(repo, '.vscode', 'mcp.json'), original, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    state.nextChoice = 'Copy snippet';
    await state.commands.get('teambrain.writeMcpConfig')?.();

    expect(await readFile(join(repo, '.vscode', 'mcp.json'), 'utf8')).toBe(
      original,
    );
    expect(state.clipboard).toContain('"teambrain"');
  });
});

describe('commands', () => {
  it('contributes exactly the commands the manifest declares', async () => {
    openFolder(await repoWithBrain());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { contributes: { commands: Array<{ command: string }> } };

    expect([...state.commands.keys()].sort()).toEqual(
      manifest.contributes.commands.map((c) => c.command).sort(),
    );
  });

  it('never runs the global install silently — the terminal is not submitted', async () => {
    openFolder(await repoWithBrain());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activate(context() as any);

    state.commands.get('teambrain.installCli')?.();

    expect(state.terminals[0]?.sent).toEqual([
      { text: 'npm install -g @teambrain/cli', execute: false },
    ]);
  });
});
