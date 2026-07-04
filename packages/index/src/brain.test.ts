import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  memoryPath,
  serializeMemoryFile,
  ulid,
  type Memory,
} from '@teambrain/core';
import {
  computeBrainChecksum,
  loadBrainDocs,
  syncIndexWithBrain,
} from './brain.js';
import { HashingEmbedder } from './embeddings.js';
import { openIndex, type SqliteIndex } from './store.js';
import { captureLogger } from './test-helpers.js';

let workDir: string;
let brainDir: string;
const openedIndexes: SqliteIndex[] = [];

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'tb-brain-'));
  brainDir = join(workDir, '.teambrain');
  await mkdir(brainDir, { recursive: true });
});

afterEach(async () => {
  while (openedIndexes.length > 0) openedIndexes.pop()?.close();
  await rm(workDir, { recursive: true, force: true });
});

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: ulid(),
    class: 'convention',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title: 'Wombats dig holes at night',
    created: '2026-01-15',
    supersedes: [],
    tags: ['test'],
    ttl_days: null,
    body: 'Wombats dig their burrows nocturnally. Plan trenching accordingly.',
    ...overrides,
  };
}

async function writeMemory(memory: Memory): Promise<string> {
  const filePath = join(brainDir, memoryPath(memory));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMemoryFile(memory), 'utf8');
  return filePath;
}

async function freshIndex(): Promise<SqliteIndex> {
  const index = await openIndex({
    dbPath: join(workDir, 'index.db'),
    embedder: new HashingEmbedder(),
  });
  openedIndexes.push(index);
  return index;
}

describe('computeBrainChecksum', () => {
  it('is stable for an unchanged tree and empty-brain safe', async () => {
    expect(await computeBrainChecksum(brainDir)).toBe(
      await computeBrainChecksum(brainDir),
    );
    await writeMemory(makeMemory());
    expect(await computeBrainChecksum(brainDir)).toBe(
      await computeBrainChecksum(brainDir),
    );
  });

  it('changes when a file is edited, added, or removed', async () => {
    const memory = makeMemory();
    const filePath = await writeMemory(memory);
    const initial = await computeBrainChecksum(brainDir);

    await writeFile(
      filePath,
      serializeMemoryFile({ ...memory, body: 'Edited body.' }),
      'utf8',
    );
    const afterEdit = await computeBrainChecksum(brainDir);
    expect(afterEdit).not.toBe(initial);

    await writeMemory(makeMemory({ title: 'Second memory arrives' }));
    const afterAdd = await computeBrainChecksum(brainDir);
    expect(afterAdd).not.toBe(afterEdit);

    await unlink(filePath);
    expect(await computeBrainChecksum(brainDir)).not.toBe(afterAdd);
  });
});

describe('loadBrainDocs', () => {
  it('maps front-matter into IndexableDocs with provenance paths', async () => {
    const memory = makeMemory({ priority: 'required', tags: ['dig', 'ops'] });
    await writeMemory(memory);
    const docs = await loadBrainDocs(brainDir);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: memory.id,
      title: memory.title,
      body: memory.body,
      class: 'convention',
      priority: 'required',
      tags: ['dig', 'ops'],
    });
    expect(docs[0]?.path).toMatch(/^memories\/conventions\/.+\.md$/);
  });

  it('skips unparseable files with a debug log instead of failing', async () => {
    await writeMemory(makeMemory());
    await writeFile(
      join(brainDir, 'memories', 'conventions', 'broken.md'),
      'not a memory file',
      'utf8',
    );
    const logger = captureLogger();
    const docs = await loadBrainDocs(brainDir, logger);
    expect(docs).toHaveLength(1);
    const entry = logger.entries.find((candidate) =>
      candidate.msg.includes('unparseable'),
    );
    expect(entry?.level).toBe('debug');
    expect(entry?.fields['reason']).toBeDefined();
  });
});

describe('syncIndexWithBrain auto-reindex (M3.1)', () => {
  it('indexes on first sync, no-ops while the checksum matches', async () => {
    await writeMemory(makeMemory());
    const index = await freshIndex();

    const first = await syncIndexWithBrain(index, brainDir);
    expect(first).toMatchObject({ reindexed: true, docCount: 1 });
    expect(index.brainChecksum).toBe(first.checksum);

    const second = await syncIndexWithBrain(index, brainDir);
    expect(second).toMatchObject({ reindexed: false, docCount: 1 });
  });

  it('reindexes on mismatch; a memory retired out of the tree disappears', async () => {
    const staying = makeMemory({ title: 'Aardvark alignment rules' });
    const leaving = makeMemory({ title: 'Obsolete badger convention' });
    await writeMemory(staying);
    const leavingPath = await writeMemory(leaving);
    const index = await freshIndex();
    await syncIndexWithBrain(index, brainDir);
    expect(
      (await index.search('obsolete badger convention', 8)).map((d) => d.id),
    ).toContain(leaving.id);

    // Retirement: git mv out of memories/ (C1). The checksum mismatch on
    // the next sync must drop it from retrieval — the R5 negative shape.
    const retiredDir = join(brainDir, 'retired');
    await mkdir(retiredDir, { recursive: true });
    await rename(leavingPath, join(retiredDir, 'moved.md'));

    const sync = await syncIndexWithBrain(index, brainDir);
    expect(sync).toMatchObject({ reindexed: true, docCount: 1 });
    const results = await index.search('obsolete badger convention', 8);
    expect(results.map((doc) => doc.id)).not.toContain(leaving.id);
    expect(index.stats().docCount).toBe(1);
  });

  it('rebuilds from scratch after the db file is lost (rebuildable cache)', async () => {
    const memory = makeMemory({ title: 'Capybara cache doctrine' });
    await writeMemory(memory);
    let index = await freshIndex();
    await syncIndexWithBrain(index, brainDir);
    openedIndexes.pop()?.close();
    await rm(join(workDir, 'index.db'));

    index = await freshIndex();
    const sync = await syncIndexWithBrain(index, brainDir);
    expect(sync.reindexed).toBe(true);
    const results = await index.search('capybara cache doctrine', 8);
    expect(results.map((doc) => doc.id)).toContain(memory.id);
  });

  it('force rebuild works even when the checksum matches', async () => {
    await writeMemory(makeMemory());
    const index = await freshIndex();
    await syncIndexWithBrain(index, brainDir);
    const forced = await syncIndexWithBrain(index, brainDir, { force: true });
    expect(forced.reindexed).toBe(true);
  });
});
