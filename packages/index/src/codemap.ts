import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCodemapEntry, type Logger } from '@teambrain/core';
import type { SqliteIndex } from './store.js';
import type { IndexableDoc } from './types.js';

// D6/R16: sync `.teambrain/codemap/files/**` into the index under C4's
// reserved source 'codemap'. Mirrors brain.ts exactly: a tree checksum in
// index meta makes the sync idempotent, and a full source replace on
// mismatch means deletions need no tombstones. When codemap is disabled the
// source is emptied, so a flipped-off flag stops serving within one open.

/** Repo-relative entry files under `<brainDir>/codemap/files/`, sorted. */
async function listCodemapFiles(brainDir: string): Promise<string[]> {
  const filesDir = join(brainDir, 'codemap', 'files');
  let entries;
  try {
    entries = await readdir(filesDir, { recursive: true, withFileTypes: true });
  } catch {
    return []; // No codemap tree — valid (feature off or never generated).
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const parent = entry.parentPath ?? filesDir;
    const absolute = join(parent, entry.name);
    const relative = absolute.slice(filesDir.length + 1).replaceAll('\\', '/');
    files.push(relative);
  }
  return files.sort();
}

/** Deterministic digest of the codemap tree (same shape as the brain's). */
export async function computeCodemapChecksum(
  brainDir: string,
): Promise<string> {
  const treeHash = createHash('sha256');
  const filesDir = join(brainDir, 'codemap', 'files');
  for (const relativePath of await listCodemapFiles(brainDir)) {
    const bytes = await readFile(join(filesDir, relativePath));
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    treeHash.update(`${relativePath}\n${fileHash}\n`);
  }
  return treeHash.digest('hex');
}

/**
 * Parses every codemap entry into an IndexableDoc. Ids are `cm:<repo path>`
 * (stable, collision-free with ULID memory ids); provenance is the
 * summarized source file so retrieval answers "where X lives" directly.
 */
export async function loadCodemapDocs(
  brainDir: string,
  logger?: Logger,
): Promise<IndexableDoc[]> {
  const docs: IndexableDoc[] = [];
  const filesDir = join(brainDir, 'codemap', 'files');
  for (const relativePath of await listCodemapFiles(brainDir)) {
    const fileText = await readFile(join(filesDir, relativePath), 'utf8');
    let parsed;
    try {
      parsed = parseCodemapEntry(fileText);
    } catch (err) {
      logger?.debug('skipping unparseable codemap entry during index', {
        path: relativePath,
        reason: (err as Error).message,
      });
      continue;
    }
    const { frontmatter, body } = parsed;
    docs.push({
      id: `cm:${frontmatter.path}`,
      title: frontmatter.path,
      body,
      status: 'active',
      priority: 'advisory',
      created: frontmatter.updated,
      ttl_days: null,
      path: frontmatter.path,
    });
  }
  return docs;
}

export interface CodemapSyncResult {
  reindexed: boolean;
  docCount: number;
}

/**
 * Brings the 'codemap' source in line with the tree (or empties it when the
 * feature is disabled). Idempotent via the stored checksum, like the brain.
 */
export async function syncIndexWithCodemap(
  index: SqliteIndex,
  brainDir: string,
  options: { enabled: boolean; force?: boolean; logger?: Logger },
): Promise<CodemapSyncResult> {
  if (!options.enabled) {
    const existing = index.stats().bySource.codemap;
    if (existing > 0) {
      await index.replaceSource('codemap', []);
      index.setCodemapChecksum(null);
      options.logger?.debug('codemap disabled; source emptied', {
        removed: existing,
      });
      return { reindexed: true, docCount: 0 };
    }
    return { reindexed: false, docCount: 0 };
  }

  const checksum = await computeCodemapChecksum(brainDir);
  if (options.force !== true && index.codemapChecksum === checksum) {
    return { reindexed: false, docCount: index.stats().bySource.codemap };
  }
  const docs = await loadCodemapDocs(brainDir, options.logger);
  await index.replaceSource('codemap', docs);
  index.setCodemapChecksum(checksum);
  options.logger?.debug('codemap reindexed', {
    checksum,
    docs: docs.length,
    forced: options.force === true,
  });
  return { reindexed: true, docCount: docs.length };
}
