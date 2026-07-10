import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBrainConfig, type Logger } from '@teambrain/core';
import {
  openIndex,
  syncIndexWithBrain,
  syncIndexWithCodemap,
  tryCreateFastEmbedEmbedder,
  type Embedder,
  type SqliteIndex,
} from '@teambrain/index';
import { candidateSpoolDir, feedbackSpoolPath, indexDbPath } from './paths.js';
import type { ToolContext } from './tools.js';

// Wiring that opens the SQLite index (with the embedder, degrading to
// lexical-only when the model is absent — principle 2) and assembles a
// ToolContext. Both `tb mcp` and `tb serve` build their backend here so the
// index/embedder/spool plumbing lives in one place.

export interface OpenBackendOptions {
  /** Machine-local runtime dir (C7); index.db + spool live under it. */
  runtimeDir: string;
  /** The repo brain (`.teambrain/`); when set, sync it into the index first. */
  brainDir?: string;
  /** Force a full reindex on open (recovery path). */
  forceReindex?: boolean;
  scope?: 'team' | 'org';
  logger?: Logger;
  /**
   * Inject an embedder, or `null` for lexical-only. Omit to auto-load
   * fastembed from the runtime models dir (degrading to lexical-only if the
   * model is unavailable). Tests pass `null` to stay offline (no download).
   */
  embedder?: Embedder | null;
}

/** codemap.enabled from brain.yaml; false when the file is absent/invalid. */
function readCodemapEnabled(brainDir: string, logger?: Logger): boolean {
  try {
    return parseBrainConfig(readFileSync(join(brainDir, 'brain.yaml'), 'utf8'))
      .codemap.enabled;
  } catch (err) {
    logger?.debug('brain.yaml unreadable; codemap treated as disabled', {
      reason: (err as Error).message,
    });
    return false;
  }
}

export interface BackendHandle {
  index: SqliteIndex;
  context: ToolContext;
  close(): void;
}

/**
 * Opens the index at `<runtimeDir>/index.db` and, if a brain dir is given,
 * brings it up to date (idempotent via the stored checksum). Returns a
 * ToolContext ready for createTools/createMcpServer plus the raw index.
 */
export async function openBackend(
  options: OpenBackendOptions,
): Promise<BackendHandle> {
  const embedder =
    options.embedder !== undefined
      ? options.embedder
      : await tryCreateFastEmbedEmbedder({
          modelsDir: join(options.runtimeDir, 'models'),
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        });
  const index = await openIndex({
    dbPath: indexDbPath(options.runtimeDir),
    embedder,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  if (options.brainDir !== undefined) {
    await syncIndexWithBrain(index, options.brainDir, {
      ...(options.forceReindex === undefined
        ? {}
        : { force: options.forceReindex }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    // D6/R16: the codemap source follows brain.yaml's codemap.enabled.
    // Disabled (or unreadable config) empties the source, so flipping the
    // flag off stops serving codemap entries on the next open.
    await syncIndexWithCodemap(index, options.brainDir, {
      enabled: readCodemapEnabled(options.brainDir, options.logger),
      ...(options.forceReindex === undefined
        ? {}
        : { force: options.forceReindex }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
  }
  const context: ToolContext = {
    backend: index,
    spoolDir: candidateSpoolDir(options.runtimeDir),
    feedbackPath: feedbackSpoolPath(options.runtimeDir),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };
  return {
    index,
    context,
    close: () => index.close(),
  };
}
