import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMemoryFile, type Logger } from '@teambrain/core';
import type { SqliteIndex } from './store.js';
import type { IndexableDoc } from './types.js';

// M3.1 brain-tree sync. The checksum of `.teambrain/memories/**` is stored
// in index meta; a mismatch on open triggers a full reindex of the 'memory'
// source. Retirement (git mv to retired/) leaves the memories/ tree, so the
// checksum changes and the reindex drops the memory — no tombstones needed.

/** Repo-relative memory files under `<brainDir>/memories/`, sorted. */
async function listMemoryFiles(brainDir: string): Promise<string[]> {
  const memoriesDir = join(brainDir, 'memories');
  let entries;
  try {
    entries = await readdir(memoriesDir, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return []; // No memories/ tree yet — an empty brain is valid.
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const parent = entry.parentPath ?? memoriesDir;
    const absolute = join(parent, entry.name);
    const relative = absolute
      .slice(memoriesDir.length + 1)
      .replaceAll('\\', '/');
    files.push(`memories/${relative}`);
  }
  return files.sort();
}

/**
 * Deterministic digest of the brain tree: sha256 over
 * `<relpath>\n<sha256(bytes)>\n` for every memory file in sorted order.
 */
export async function computeBrainChecksum(brainDir: string): Promise<string> {
  const treeHash = createHash('sha256');
  for (const relativePath of await listMemoryFiles(brainDir)) {
    const bytes = await readFile(join(brainDir, relativePath));
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    treeHash.update(`${relativePath}\n${fileHash}\n`);
  }
  return treeHash.digest('hex');
}

/**
 * Parses every memory file into an IndexableDoc. Unparseable files are
 * skipped with a debug log (principle 2): a broken file must not take
 * retrieval down, and `tb lint` is the tool that surfaces it loudly.
 */
export async function loadBrainDocs(
  brainDir: string,
  logger?: Logger,
): Promise<IndexableDoc[]> {
  const docs: IndexableDoc[] = [];
  for (const relativePath of await listMemoryFiles(brainDir)) {
    const fileText = await readFile(join(brainDir, relativePath), 'utf8');
    let parsed;
    try {
      parsed = parseMemoryFile(fileText);
    } catch (err) {
      logger?.debug('skipping unparseable memory file during index', {
        path: relativePath,
        reason: (err as Error).message,
      });
      continue;
    }
    const { frontmatter, body } = parsed;
    docs.push({
      id: frontmatter.id,
      title: frontmatter.title,
      body,
      class: frontmatter.class,
      scope: frontmatter.scope,
      status: frontmatter.status,
      priority: frontmatter.priority,
      created: frontmatter.created,
      ttl_days: frontmatter.ttl_days,
      tags: frontmatter.tags,
      path: relativePath,
    });
  }
  return docs;
}

export interface SyncResult {
  reindexed: boolean;
  checksum: string;
  docCount: number;
}

/**
 * Auto-reindex on checksum mismatch (M3.1). `force` rebuilds regardless —
 * the recovery path when the cache is suspected corrupt, which is always
 * safe because git is the source of truth.
 */
export async function syncIndexWithBrain(
  index: SqliteIndex,
  brainDir: string,
  options: { force?: boolean; logger?: Logger } = {},
): Promise<SyncResult> {
  const checksum = await computeBrainChecksum(brainDir);
  if (options.force !== true && index.brainChecksum === checksum) {
    return {
      reindexed: false,
      checksum,
      docCount: index.stats().bySource.memory,
    };
  }
  const docs = await loadBrainDocs(brainDir, options.logger);
  await index.replaceSource('memory', docs);
  index.setBrainChecksum(checksum);
  options.logger?.debug('brain reindexed', {
    checksum,
    docs: docs.length,
    forced: options.force === true,
  });
  return { reindexed: true, checksum, docCount: docs.length };
}
