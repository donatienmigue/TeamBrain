import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCli, type CliLookup } from './cli.js';

function lookup(options: {
  files?: string[];
  path?: string | undefined;
}): CliLookup {
  const files = new Set(options.files ?? []);
  return {
    fileExists: (path) => files.has(path),
    onPath: () => options.path,
  };
}

describe('resolveCli', () => {
  it('prefers an explicit teambrain.cliPath over everything else', () => {
    const result = resolveCli({
      configured: '/opt/tb/bin/tb',
      workspaceFolders: ['/repo'],
      lookup: lookup({
        files: [join('/repo', 'node_modules', '.bin', 'tb')],
        path: '/usr/local/bin/tb',
      }),
      platform: 'linux',
    });
    expect(result).toEqual({
      found: true,
      command: '/opt/tb/bin/tb',
      source: 'setting',
    });
  });

  it('honours a configured path even when it does not exist, so typos surface', () => {
    // Silently falling back to a different `tb` would make a wrong setting
    // look like it worked, against a possibly very different CLI version.
    const result = resolveCli({
      configured: '/nope/tb',
      workspaceFolders: [],
      lookup: lookup({ path: '/usr/local/bin/tb' }),
      platform: 'linux',
    });
    expect(result).toMatchObject({ command: '/nope/tb', source: 'setting' });
  });

  it('ignores a whitespace-only setting', () => {
    const result = resolveCli({
      configured: '   ',
      workspaceFolders: [],
      lookup: lookup({ path: '/usr/local/bin/tb' }),
      platform: 'linux',
    });
    expect(result).toEqual({
      found: true,
      command: '/usr/local/bin/tb',
      source: 'path',
    });
  });

  it('prefers a workspace-pinned CLI over a global one', () => {
    const local = join('/repo', 'node_modules', '.bin', 'tb');
    const result = resolveCli({
      workspaceFolders: ['/repo'],
      lookup: lookup({ files: [local], path: '/usr/local/bin/tb' }),
      platform: 'linux',
    });
    expect(result).toEqual({
      found: true,
      command: local,
      source: 'workspace',
    });
  });

  it('searches every workspace folder in order', () => {
    const second = join('/b', 'node_modules', '.bin', 'tb');
    const result = resolveCli({
      workspaceFolders: ['/a', '/b'],
      lookup: lookup({ files: [second] }),
      platform: 'linux',
    });
    expect(result).toMatchObject({ command: second, source: 'workspace' });
  });

  it('finds the .cmd shim on Windows', () => {
    const shim = join('/repo', 'node_modules', '.bin', 'tb.cmd');
    const result = resolveCli({
      workspaceFolders: ['/repo'],
      lookup: lookup({ files: [shim] }),
      platform: 'win32',
    });
    expect(result).toMatchObject({ command: shim, source: 'workspace' });
  });

  it('reports not found rather than guessing a command', () => {
    // The status bar depends on this being falsifiable: returning a bare 'tb'
    // here would produce a registered server that fails to spawn.
    expect(
      resolveCli({
        workspaceFolders: ['/repo'],
        lookup: lookup({}),
        platform: 'linux',
      }),
    ).toEqual({ found: false });
  });
});
