import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexDbPath } from '@teambrain/mcp';
import { runReindexCommand } from './reindex-command.js';

// C6 `tb reindex` — the recovery path. Negative tests are first-class:
// missing brain → exit 2; a corrupt index.db must be reset and rebuilt
// (the index is a cache, never the source of truth).

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const MEMORY = `---
id: 01JZRX0A1B2C3D4E5F6G7H8J9K
class: convention
scope: team
status: active
priority: advisory
title: "Validate input with zod"
created: 2026-07-01
supersedes: []
tags: []
ttl_days: null
---

Parse every boundary value with a zod schema before use.
`;

async function repoWithBrain(): Promise<string> {
  const repo = await tempDir('tb-reindex-repo-');
  const memDir = join(repo, '.teambrain', 'memories', 'conventions');
  await mkdir(memDir, { recursive: true });
  await writeFile(
    join(memDir, '01JZRX0A1B2C3D4E5F6G7H8J9K-validate-input-with-zod.md'),
    MEMORY,
    'utf8',
  );
  return repo;
}

describe('tb reindex (C6 recovery path)', () => {
  it('rebuilds the index from the brain tree', async () => {
    const repo = await repoWithBrain();
    const runtimeDir = await tempDir('tb-reindex-home-');
    const result = await runReindexCommand(repo, {
      runtimeDir,
      embedder: null,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('documents: 1');
  });

  it('resets and rebuilds when index.db is corrupt (recovery path)', async () => {
    const repo = await repoWithBrain();
    const runtimeDir = await tempDir('tb-reindex-home-');
    // Not a SQLite database — opening this must not be fatal.
    await writeFile(indexDbPath(runtimeDir), 'this is not a database', 'utf8');

    const result = await runReindexCommand(repo, {
      runtimeDir,
      embedder: null,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('documents: 1');
    expect(result.output).toContain('was unreadable and was reset');
  });

  it('exits 2 when there is no brain to rebuild from (negative)', async () => {
    const repo = await tempDir('tb-reindex-nobrain-');
    const runtimeDir = await tempDir('tb-reindex-home-');
    const result = await runReindexCommand(repo, {
      runtimeDir,
      embedder: null,
    });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('no brain at');
  });
});
