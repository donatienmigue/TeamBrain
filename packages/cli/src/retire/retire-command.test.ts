import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryPath, serializeMemoryFile, type Memory } from '@teambrain/core';
import { runRetireCommand } from './retire-command.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const ID = '01JD00000000000000000000AA';

function memory(): Memory {
  return {
    id: ID,
    class: 'learning',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title: 'Cache the parsed config',
    created: '2026-07-06',
    evidence: { sessions: ['s1'], commits: [] },
    supersedes: [],
    tags: [],
    ttl_days: null,
    body: 'Parse the config once and cache it.',
  };
}

/** A git repo on main whose .teambrain holds one active memory. */
function makeRepo(withMemory: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-retire-'));
  tempDirs.push(dir);
  git(['init', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@example.invalid'], dir);
  git(['config', 'user.name', 'T'], dir);
  const brainDir = join(dir, '.teambrain');
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'brain.yaml'), 'version: 1\n', 'utf8');
  if (withMemory) {
    const abs = join(brainDir, memoryPath(memory()));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeMemoryFile(memory()), 'utf8');
  }
  git(['add', '-A'], dir);
  git(['commit', '-m', 'baseline'], dir);
  return dir;
}

describe('tb retire (M8.1)', () => {
  it('retires a memory onto a branch, leaving main untouched', () => {
    const repo = makeRepo(true);
    const result = runRetireCommand(repo, ID, 'superseded', { openPr: false });
    expect(result.exitCode).toBe(0);

    const branch = `teambrain/retire-${ID}`;
    // The branch moved the file to retired/ with status: retired…
    const retired = git(
      ['show', `${branch}:.teambrain/retired/${ID}-cache-the-parsed-config.md`],
      repo,
    );
    expect(retired).toContain('status: retired');
    // …and no longer has it under memories/.
    expect(git(['ls-tree', '-r', '--name-only', branch], repo)).not.toContain(
      'memories/learnings',
    );
    // main still carries the active memory (never touched).
    expect(git(['ls-tree', '-r', '--name-only', 'main'], repo)).toContain(
      'memories/learnings',
    );
  });

  it('exits 1 when the id is unknown', () => {
    const repo = makeRepo(true);
    const result = runRetireCommand(repo, '01JD0000000000000000000XYZ', 'x', {
      openPr: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('no active memory');
  });

  it('exits 1 when no reason is given', () => {
    const repo = makeRepo(true);
    const result = runRetireCommand(repo, ID, '  ', { openPr: false });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('reason is required');
  });
});
