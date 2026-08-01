import { describe, expect, it } from 'vitest';
import { ensureVsCodeMcpServer, vscodeAdapter } from '@teambrain/hooks';
import {
  UnparsableConfigError,
  configSnippet,
  mergeMcpConfig,
} from './fallback-config.js';

describe('mergeMcpConfig', () => {
  it('creates the file content with VS Code’s `servers` root key', () => {
    const { contents, changed } = mergeMcpConfig('');
    expect(changed).toBe(true);
    const parsed = JSON.parse(contents);
    expect(parsed.servers.teambrain).toEqual({
      type: 'stdio',
      command: 'tb',
      args: ['mcp', '${workspaceFolder}', '--client', 'vscode'],
    });
    expect(parsed.mcpServers).toBeUndefined();
    expect(contents.endsWith('\n')).toBe(true);
  });

  it('is idempotent on an already-configured file', () => {
    const first = mergeMcpConfig('');
    const second = mergeMcpConfig(first.contents);
    expect(second.changed).toBe(false);
    expect(second.contents).toBe(first.contents);
  });

  it('keeps other servers and unrelated keys', () => {
    const existing = JSON.stringify({
      inputs: [{ id: 'pat', type: 'promptString' }],
      servers: { github: { type: 'http', url: 'https://example' } },
    });
    const parsed = JSON.parse(mergeMcpConfig(existing).contents);
    expect(parsed.servers.github).toEqual({
      type: 'http',
      url: 'https://example',
    });
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.servers.teambrain).toBeDefined();
  });

  it('refuses to rewrite a file it cannot parse, rather than losing comments', () => {
    // VS Code accepts JSONC here. A JSON round-trip would silently delete the
    // user's comments, so the command degrades to "copy this snippet".
    const jsonc = '{\n  // my servers\n  "servers": {}\n}';
    expect(() => mergeMcpConfig(jsonc)).toThrow(UnparsableConfigError);
  });

  it('refuses a top-level array', () => {
    expect(() => mergeMcpConfig('[]')).toThrow(UnparsableConfigError);
  });

  it('treats a whitespace-only file as empty', () => {
    expect(mergeMcpConfig('   \n').changed).toBe(true);
  });
});

describe('drift with the `vscode` capture adapter', () => {
  it('writes byte-identical config to `tb install vscode`', () => {
    // Two code paths write the same file: this command (for forks without the
    // registration API) and the CLI installer. If they diverge, one of them is
    // wrong and the user gets a config that depends on how they set it up.
    const fromAdapter = `${JSON.stringify(ensureVsCodeMcpServer({}).value, null, 2)}\n`;
    expect(mergeMcpConfig('').contents).toBe(fromAdapter);
  });

  it('uses the adapter’s registry id as the `--client` value', () => {
    expect(mergeMcpConfig('').contents).toContain(
      `"--client",\n        "${vscodeAdapter.tool}"`,
    );
  });
});

describe('configSnippet', () => {
  it('is a pasteable object containing only the teambrain server', () => {
    const parsed = JSON.parse(configSnippet());
    expect(Object.keys(parsed.servers)).toEqual(['teambrain']);
  });
});
