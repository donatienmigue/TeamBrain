import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeSessionEvent, type SessionEvent } from '@teambrain/core';
import { gitSessionSource } from './sessions.js';
import { event } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function recordText(...events: SessionEvent[]): string {
  return events.map(serializeSessionEvent).join('\n') + '\n';
}

/** A repo with a teambrain/sessions branch holding two records in two commits. */
async function repoWithSessions(): Promise<{
  repo: string;
  firstCommit: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'tb-sess-'));
  cleanups.push(() => rm(repo, { recursive: true, force: true }));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  git(['commit', '-q', '--allow-empty', '-m', 'init'], repo);

  git(['checkout', '-q', '-b', 'teambrain/sessions'], repo);
  await mkdir(join(repo, 'sessions'), { recursive: true });
  await writeFile(
    join(repo, 'sessions', 's1.jsonl'),
    recordText(
      event('s1', 'tool_use', { kind: 'edit', path: 'src/a.ts' }),
      event('s1', 'session_end', {
        outcome: 'committed',
        duration_s: 10,
        turns: 2,
        commit_shas: ['sha-a', 'sha-b'],
      }),
    ),
    'utf8',
  );
  git(['add', 'sessions'], repo);
  git(['commit', '-q', '-m', 'session s1'], repo);
  const firstCommit = git(['rev-parse', 'HEAD'], repo);

  await writeFile(
    join(repo, 'sessions', 's2.jsonl'),
    recordText(event('s2', 'tool_use', { kind: 'edit', path: 'src/b.ts' })),
    'utf8',
  );
  git(['add', 'sessions'], repo);
  git(['commit', '-q', '-m', 'session s2'], repo);

  return { repo, firstCommit };
}

describe('gitSessionSource (M6.1)', () => {
  it('reads all records and extracts commit shas from session_end', async () => {
    const { repo } = await repoWithSessions();
    const source = gitSessionSource(repo);
    const records = source.readNewRecords(null);
    expect(records.map((r) => r.sid)).toEqual(['s1', 's2']);
    const s1 = records.find((r) => r.sid === 's1');
    expect(s1?.events).toHaveLength(2);
    expect(s1?.commitShas).toEqual(['sha-a', 'sha-b']);
    expect(s1?.repo).toBe('acme/api');
  });

  it('returns only records added since the watermark', async () => {
    const { repo, firstCommit } = await repoWithSessions();
    const records = gitSessionSource(repo).readNewRecords(firstCommit);
    expect(records.map((r) => r.sid)).toEqual(['s2']);
  });

  it('head() is the branch tip; empty when the branch is absent', async () => {
    const { repo } = await repoWithSessions();
    expect(gitSessionSource(repo).head()).toMatch(/^[0-9a-f]{40}$/);
    const bare = await mkdtemp(join(tmpdir(), 'tb-bare-'));
    cleanups.push(() => rm(bare, { recursive: true, force: true }));
    git(['init', '-q'], bare);
    expect(gitSessionSource(bare).head()).toBeNull();
    expect(gitSessionSource(bare).readNewRecords(null)).toEqual([]);
  });
});
