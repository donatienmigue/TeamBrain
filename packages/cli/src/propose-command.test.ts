import {
  mkdtemp,
  rm,
  readFile,
  readdir,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { candidateSpoolDir, sessionSpoolDir } from '@teambrain/mcp';
import { runProposeCommand } from './propose-command.js';

// C6 `tb propose` — the manual escape hatch. Trust model must match the C3
// MCP tool: local candidate spool only, never the brain. Negative tests are
// first-class: an invalid draft is a validation error (exit 3), not a queued
// candidate.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-propose-home-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('tb propose (C6 escape hatch)', () => {
  it('queues a valid draft to the candidate spool', async () => {
    const runtimeDir = await tempHome();
    const result = runProposeCommand(
      {
        class: 'learning',
        title: 'vec0 rowids bind as int64',
        body: 'Convert rowids to BigInt before hitting a vec0 table.',
        tags: ['sqlite'],
      },
      { runtimeDir },
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Queued candidate');
    expect(result.output).toContain('nothing was written to the brain');

    const spooled = await readdir(candidateSpoolDir(runtimeDir));
    expect(spooled).toHaveLength(1);
    const record = JSON.parse(
      await readFile(
        join(candidateSpoolDir(runtimeDir), spooled[0] as string),
        'utf8',
      ),
    );
    expect(record.draft.class).toBe('learning');
    expect(record.draft.tags).toEqual(['sqlite']);
  });

  it('reads the body from stdin when --body is absent', async () => {
    const runtimeDir = await tempHome();
    const result = runProposeCommand(
      { class: 'convention', title: 'Squash migrations' },
      { runtimeDir, readStdin: () => 'Squash DB migrations before merging.\n' },
    );
    expect(result.exitCode).toBe(0);
    const spooled = await readdir(candidateSpoolDir(runtimeDir));
    const record = JSON.parse(
      await readFile(
        join(candidateSpoolDir(runtimeDir), spooled[0] as string),
        'utf8',
      ),
    );
    expect(record.draft.body).toBe('Squash DB migrations before merging.');
  });

  it('cites the most recent session record as evidence', async () => {
    const runtimeDir = await tempHome();
    const spool = sessionSpoolDir(runtimeDir);
    await mkdir(spool, { recursive: true });
    await writeFile(join(spool, 'sess-recent.jsonl'), '{"v":1}\n', 'utf8');

    const result = runProposeCommand(
      {
        class: 'decision',
        title: 'Use RRF for fusion',
        body: 'Fuse lexical and vector ranks with RRF k=60.',
      },
      { runtimeDir },
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('evidence: session sess-recent');
    const spooled = await readdir(candidateSpoolDir(runtimeDir));
    const record = JSON.parse(
      await readFile(
        join(candidateSpoolDir(runtimeDir), spooled[0] as string),
        'utf8',
      ),
    );
    expect(record.draft.evidence).toEqual({
      sessions: ['sess-recent'],
      commits: [],
    });
  });

  it('rejects an invalid draft with exit 3 and queues nothing (negative)', async () => {
    const runtimeDir = await tempHome();
    const result = runProposeCommand(
      { class: 'wisdom', title: 'Not a real class', body: 'x' },
      { runtimeDir, readStdin: () => '' },
    );
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('invalid candidate');
    // Nothing must land in the spool on a rejected draft.
    await expect(readdir(candidateSpoolDir(runtimeDir))).rejects.toThrow();
  });

  it('rejects an empty body when stdin has nothing (negative)', async () => {
    const runtimeDir = await tempHome();
    const result = runProposeCommand(
      { class: 'learning', title: 'No body' },
      { runtimeDir, readStdin: () => '' },
    );
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('invalid candidate');
  });
});
