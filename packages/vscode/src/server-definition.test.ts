import { describe, expect, it } from 'vitest';
import type { CliResolution } from './cli.js';
import { brainDir, buildServerRecords } from './server-definition.js';

const cli: CliResolution = {
  found: true,
  command: '/usr/local/bin/tb',
  source: 'path',
};

describe('buildServerRecords', () => {
  it('launches `tb mcp <repo> --client vscode` for a folder with a brain', () => {
    const records = buildServerRecords({
      cli,
      folders: [{ path: '/repo', hasBrain: true }],
    });
    expect(records).toEqual([
      {
        label: 'TeamBrain',
        command: '/usr/local/bin/tb',
        args: ['mcp', '/repo', '--client', 'vscode'],
        cwd: '/repo',
      },
    ]);
  });

  it('tags events as vscode so capture is attributed to the right vendor', () => {
    const [record] = buildServerRecords({
      cli,
      folders: [{ path: '/repo', hasBrain: true }],
    });
    expect(record?.args).toContain('--client');
    expect(record?.args).toContain('vscode');
  });

  it('skips folders without a brain', () => {
    const records = buildServerRecords({
      cli,
      folders: [
        { path: '/repo', hasBrain: false },
        { path: '/other', hasBrain: true },
      ],
    });
    expect(records.map((r) => r.cwd)).toEqual(['/other']);
  });

  it('returns nothing when no CLI was found', () => {
    // Registering a server whose command does not exist produces a spawn
    // error in the MCP view; the status bar says "install the CLI" instead.
    expect(
      buildServerRecords({
        cli: { found: false },
        folders: [{ path: '/repo', hasBrain: true }],
      }),
    ).toEqual([]);
  });

  it('returns nothing when no folder has a brain', () => {
    expect(
      buildServerRecords({
        cli,
        folders: [{ path: '/repo', hasBrain: false }],
      }),
    ).toEqual([]);
  });

  it('disambiguates labels in a multi-root workspace', () => {
    const records = buildServerRecords({
      cli,
      folders: [
        { path: '/work/api', hasBrain: true },
        { path: '/work/web', hasBrain: true },
      ],
    });
    expect(records.map((r) => r.label)).toEqual([
      'TeamBrain (api)',
      'TeamBrain (web)',
    ]);
    // Each server is scoped to its own repo — brains must not cross-serve.
    expect(records.map((r) => r.cwd)).toEqual(['/work/api', '/work/web']);
    expect(records[0]?.args).toContain('/work/api');
  });

  it('keeps the plain label when only one folder has a brain', () => {
    const records = buildServerRecords({
      cli,
      folders: [
        { path: '/work/api', hasBrain: true },
        { path: '/work/web', hasBrain: false },
      ],
    });
    expect(records.map((r) => r.label)).toEqual(['TeamBrain']);
  });
});

describe('brainDir', () => {
  it('points at the C7 brain directory', () => {
    expect(brainDir('/repo')).toBe('/repo/.teambrain');
  });
});
