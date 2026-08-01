import { describe, expect, it } from 'vitest';
import type { CliResolution } from './cli.js';
import { describeStatus, type ExtensionState } from './status.js';
import type { StdioServerRecord } from './server-definition.js';

const foundCli: CliResolution = {
  found: true,
  command: '/usr/local/bin/tb',
  source: 'path',
};

const server: StdioServerRecord = {
  label: 'TeamBrain',
  command: '/usr/local/bin/tb',
  args: ['mcp', '/repo', '--client', 'vscode'],
  cwd: '/repo',
};

function state(overrides: Partial<ExtensionState> = {}): ExtensionState {
  return {
    registration: 'native',
    cli: foundCli,
    folders: [{ path: '/repo', hasBrain: true }],
    servers: [server],
    ...overrides,
  };
}

describe('describeStatus', () => {
  it('reports ready with the brain count when everything is wired', () => {
    const view = describeStatus(state());
    expect(view.severity).toBe('ok');
    expect(view.text).toContain('$(check)');
    expect(view.tooltip).toContain('1 brain served');
    expect(view.tooltip).toContain('/usr/local/bin/tb');
  });

  it('pluralises the brain count', () => {
    const view = describeStatus(
      state({
        folders: [
          { path: '/a', hasBrain: true },
          { path: '/b', hasBrain: true },
        ],
        servers: [server, { ...server, label: 'TeamBrain (b)', cwd: '/b' }],
      }),
    );
    expect(view.tooltip).toContain('2 brains served');
  });

  it('names the missing CLI first — it blocks everything else', () => {
    const view = describeStatus(state({ cli: { found: false }, servers: [] }));
    expect(view.severity).toBe('warning');
    expect(view.tooltip).toContain('npm install -g @teambrain/cli');
  });

  it('asks for `tb init` when the CLI is there but the brain is not', () => {
    const view = describeStatus(
      state({ folders: [{ path: '/repo', hasBrain: false }], servers: [] }),
    );
    expect(view.severity).toBe('warning');
    expect(view.tooltip).toContain('tb init');
  });

  it('says no folder is open when there is no workspace', () => {
    const view = describeStatus(state({ folders: [], servers: [] }));
    expect(view.severity).toBe('warning');
    expect(view.tooltip).toContain('no folder is open');
  });

  it('explains the fork limitation rather than claiming success', () => {
    // Cursor/Windsurf install the extension happily; claiming "registered"
    // there would be a lie the user only discovers when recall never works.
    const view = describeStatus(state({ registration: 'manual' }));
    expect(view.severity).toBe('warning');
    expect(view.tooltip).toContain('MCP registration API');
    expect(view.tooltip).toContain('Write MCP configuration');
  });

  it('surfaces where the CLI came from, so a surprising one is visible', () => {
    const view = describeStatus(
      state({
        cli: {
          found: true,
          command: '/repo/node_modules/.bin/tb',
          source: 'workspace',
        },
      }),
    );
    expect(view.tooltip).toContain('workspace node_modules');
  });
});
