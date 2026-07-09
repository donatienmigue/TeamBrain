import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  EnvironmentError,
  exitCodeForError,
  type ErrorExitCode,
  type Logger,
} from '@teambrain/core';
import { indexDbPath, openBackend, resolveRuntimeDir } from '@teambrain/mcp';
import type { Embedder } from '@teambrain/index';

// C6 `tb reindex` (TECH_BRIEF §4.2): rebuild the SQLite index from the brain
// repo — the recovery path. The index is a rebuildable cache (principle 1),
// so this may always delete and start over; a corrupt index.db must never be
// fatal, only a reason to rebuild from git.

export interface ReindexOptions {
  runtimeDir?: string;
  /** Inject an embedder (tests pass `null` to stay offline). */
  embedder?: Embedder | null;
  logger?: Logger;
}

export interface ReindexResult {
  exitCode: 0 | ErrorExitCode;
  output: string;
}

/** Deletes index.db and its WAL/SHM sidecars; safe because git is the truth. */
function removeIndexFiles(runtimeDir: string): void {
  const dbPath = indexDbPath(runtimeDir);
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(path, { force: true });
  }
}

export async function runReindexCommand(
  repoDir: string,
  options: ReindexOptions = {},
): Promise<ReindexResult> {
  const root = resolve(repoDir);
  const brainDir = join(root, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: exitCodeForError(
        new EnvironmentError(`no brain at ${brainDir}`),
      ),
      output: `tb reindex: no brain at ${brainDir} — run \`tb init\` and merge its PR first\n`,
    };
  }

  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  let recovered = false;

  const open = () =>
    openBackend({
      runtimeDir,
      brainDir,
      forceReindex: true,
      ...(options.embedder === undefined ? {} : { embedder: options.embedder }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });

  let backend;
  try {
    backend = await open();
  } catch (err) {
    // Recovery path: a corrupt index.db must not block the rebuild. Delete
    // the cache and start from the brain tree (git is the source of truth).
    options.logger?.debug('index open failed; deleting cache and rebuilding', {
      reason: (err as Error).message,
    });
    removeIndexFiles(runtimeDir);
    recovered = true;
    try {
      backend = await open();
    } catch (retryErr) {
      return {
        exitCode: exitCodeForError(retryErr),
        output: `tb reindex: rebuild failed after resetting the index: ${(retryErr as Error).message}\n`,
      };
    }
  }

  try {
    const stats = backend.index.stats();
    let output =
      `tb reindex: rebuilt index from ${brainDir}\n` +
      `  documents: ${stats.docCount}\n` +
      `  db:        ${indexDbPath(runtimeDir)}\n`;
    if (recovered) {
      output += '  note: previous index was unreadable and was reset first\n';
    }
    if (stats.lexicalOnly) {
      output +=
        '  note: lexical-only (embedding model unavailable); retrieval still works\n';
    }
    return { exitCode: 0, output };
  } finally {
    backend.close();
  }
}
