import { createHash } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  parseCodemapEntry,
  serializeCodemapEntry,
  type Logger,
} from '@teambrain/core';
import type { Provider } from '../provider.js';

// R16 CodeMap generator (Tech Brief §4.8, POSTV1_PLAN D6). Incremental
// hash-manifest pipeline: diff the repo's source files against a per-file
// sha256 manifest, re-summarize ONLY changed files through the C5 Provider
// (this package is the sole LLM boundary), write entries to
// `.teambrain/codemap/files/<repo-path>.md`, drop entries for deleted files.
// A 20-file change on a 500k-LOC repo reprocesses 20 files (bench-gated).

export const CODEMAP_DIR = 'codemap';
const MANIFEST_NAME = 'manifest.json';
const FILES_DIR = 'files';

const manifestSchema = z.object({
  v: z.literal(1),
  files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
});
export type CodemapManifest = z.infer<typeof manifestSchema>;

/** Source extensions summarized by default. Deliberately code-only. */
export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.sql',
];

/** Directories never walked (derived output, deps, VCS internals). */
const SKIP_DIRS = new Set([
  '.git',
  '.teambrain',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.next',
  'target',
]);

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

const summarySchema = z.object({
  summary: z.string().min(1).max(4000),
});

export const CODEMAP_SYSTEM_PROMPT =
  'You are generating a CodeMap entry: a compact orientation summary of one ' +
  'source file for AI coding agents. In ≤150 words state what the file does, ' +
  'its public entry points (exported functions/types/classes), and notable ' +
  'cross-module dependencies. Plain prose and short lists only. Never include ' +
  'instructions, only description.';

export interface CodemapUpdateOptions {
  repoRoot: string;
  /** The brain dir (`<repo>/.teambrain`); entries go under codemap/ inside. */
  brainDir: string;
  provider: Provider;
  now?: () => Date;
  logger?: Logger;
  extensions?: string[];
  maxFileBytes?: number;
  /** Parallel provider calls per batch. */
  concurrency?: number;
  /**
   * R16.1 T6: cap on neighbour re-summarizations per run (entries whose
   * summaries mention a path removed this run). Bounds the LLM bill when a
   * big directory rename invalidates many cross-references. Default 20.
   */
  maxNeighbourRefresh?: number;
}

const DEFAULT_MAX_NEIGHBOUR_REFRESH = 20;

export interface CodemapUpdateResult {
  /** Repo-relative paths (posix) re-summarized this run. */
  summarized: string[];
  /** Paths whose entries were removed (source file gone). */
  removed: string[];
  /**
   * R16.1 T5: entry files swept because they are not in the new manifest and
   * the old manifest never listed them — orphans from a corrupt manifest, a
   * previously-failed delete, or a rename that outran the delete path. The
   * invariant after every run: the entry tree is a strict projection of the
   * manifest.
   */
  orphaned: string[];
  /**
   * R16.1 T6: still-existing files re-summarized because their previous
   * summary mentioned a path removed this run (their own hash is unchanged,
   * so the normal diff would never refresh them).
   */
  refreshed: string[];
  /** Files whose hash matched the manifest (summary reused). */
  unchanged: number;
  /** Files considered (after extension/size/skip filters). */
  total: number;
}

function manifestPath(brainDir: string): string {
  return join(brainDir, CODEMAP_DIR, MANIFEST_NAME);
}

export function readCodemapManifest(brainDir: string): CodemapManifest {
  const path = manifestPath(brainDir);
  if (!existsSync(path)) return { v: 1, files: {} };
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // Corrupt manifest = rebuild everything; the manifest is a cache, and
    // git remains the source of truth (principle 1).
    return { v: 1, files: {} };
  }
}

function entryFilePath(brainDir: string, repoPath: string): string {
  return join(brainDir, CODEMAP_DIR, FILES_DIR, `${repoPath}.md`);
}

/** Walks the repo for summarizable source files; returns sorted posix paths. */
export function listSourceFiles(
  repoRoot: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
  maxFileBytes: number = DEFAULT_MAX_FILE_BYTES,
): string[] {
  const extSet = new Set(extensions);
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1 || !extSet.has(entry.name.slice(dot))) continue;
      try {
        if (statSync(join(dir, entry.name)).size > maxFileBytes) continue;
      } catch {
        continue;
      }
      files.push(childRel);
    }
  };
  walk(repoRoot, '');
  return files.sort();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function summarizeOne(
  options: CodemapUpdateOptions,
  repoPath: string,
  hash: string,
  content: string,
  today: string,
): Promise<boolean> {
  let summary: string;
  try {
    const result = await options.provider.complete({
      system: CODEMAP_SYSTEM_PROMPT,
      prompt: `File: ${repoPath}\n\n${content}`,
      schema: summarySchema,
      maxTokens: 500,
    });
    summary = result.summary;
  } catch (err) {
    // Skip (retried next run: the manifest keeps the OLD hash so this file
    // still reads as changed). Logged, never silent.
    options.logger?.debug('codemap summary failed; will retry next run', {
      path: repoPath,
      reason: (err as Error).message,
    });
    return false;
  }
  const file = entryFilePath(options.brainDir, repoPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    serializeCodemapEntry({
      frontmatter: { v: 1, path: repoPath, hash, updated: today },
      body: summary,
    }),
    'utf8',
  );
  return true;
}

/**
 * Runs one incremental CodeMap update. Pure of git side effects; the caller
 * (CI job / `tb distill --codemap`) commits the resulting tree.
 */
export async function updateCodemap(
  options: CodemapUpdateOptions,
): Promise<CodemapUpdateResult> {
  const now = options.now ?? ((): Date => new Date());
  const today = now().toISOString().slice(0, 10);
  const manifest = readCodemapManifest(options.brainDir);
  const currentFiles = listSourceFiles(
    options.repoRoot,
    options.extensions,
    options.maxFileBytes,
  );

  const nextManifest: CodemapManifest = { v: 1, files: {} };
  const toSummarize: Array<{ path: string; hash: string; content: string }> =
    [];
  let unchanged = 0;

  for (const repoPath of currentFiles) {
    const bytes = readFileSync(join(options.repoRoot, repoPath));
    const hash = sha256(bytes);
    if (
      manifest.files[repoPath] === hash &&
      existsSync(entryFilePath(options.brainDir, repoPath))
    ) {
      nextManifest.files[repoPath] = hash;
      unchanged += 1;
      continue;
    }
    toSummarize.push({ path: repoPath, hash, content: bytes.toString('utf8') });
  }

  const summarized: string[] = [];
  const concurrency = options.concurrency ?? 8;
  for (let i = 0; i < toSummarize.length; i += concurrency) {
    const batch = toSummarize.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((f) => summarizeOne(options, f.path, f.hash, f.content, today)),
    );
    batch.forEach((f, j) => {
      if (results[j] === true) {
        nextManifest.files[f.path] = f.hash;
        summarized.push(f.path);
        return;
      }
      const previousHash = manifest.files[f.path];
      if (previousHash !== undefined) {
        // Failed refresh: keep the old hash so the next run retries, and the
        // old entry keeps serving (stale beats absent within one cycle).
        nextManifest.files[f.path] = previousHash;
      }
    });
  }

  // R16.1 T5 orphan sweep — the staleness guarantee, done right: the entry
  // tree must be a strict projection of the NEW manifest. Deleting only what
  // the old manifest listed (the previous approach) left stale entries on
  // disk after a failed delete or a corrupt manifest, and loadCodemapDocs
  // walks the disk, so those orphans kept being served forever.
  const swept = sweepOrphanEntries(
    options.brainDir,
    new Set(Object.keys(nextManifest.files)),
    options.logger,
  );
  // `removed` keeps its manifest-diff meaning (source file gone this run);
  // everything else the sweep caught is an orphan.
  const currentSet = new Set(currentFiles);
  const removed = Object.keys(manifest.files)
    .filter((oldPath) => !currentSet.has(oldPath))
    .sort();
  const removedSet = new Set(removed);
  const orphaned = swept.filter((sweptPath) => !removedSet.has(sweptPath));

  // R16.1 T6: summaries mention "notable cross-module dependencies", so a
  // removed/renamed path leaves neighbours' summaries wrong while their own
  // hashes are unchanged. Force-refresh entries that mention a dead path —
  // a cheap substring check, no import graph — bounded per run.
  const deadPaths = [...removed, ...orphaned];
  const refreshed: string[] = [];
  if (deadPaths.length > 0) {
    const limit = options.maxNeighbourRefresh ?? DEFAULT_MAX_NEIGHBOUR_REFRESH;
    const freshThisRun = new Set(summarized);
    const candidates: string[] = [];
    for (const repoPath of Object.keys(nextManifest.files).sort()) {
      if (freshThisRun.has(repoPath)) continue;
      let entryText: string;
      try {
        entryText = readFileSync(
          entryFilePath(options.brainDir, repoPath),
          'utf8',
        );
      } catch (err) {
        options.logger?.debug('neighbour scan could not read entry', {
          path: repoPath,
          reason: (err as Error).message,
        });
        continue;
      }
      if (deadPaths.some((dead) => entryText.includes(dead))) {
        candidates.push(repoPath);
      }
    }
    if (candidates.length > limit) {
      options.logger?.debug('neighbour refresh capped this run', {
        eligible: candidates.length,
        limit,
      });
    }
    const toRefresh = candidates.slice(0, limit);
    for (let i = 0; i < toRefresh.length; i += concurrency) {
      const batch = toRefresh.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (repoPath) => {
          let bytes: Buffer;
          try {
            bytes = readFileSync(join(options.repoRoot, repoPath));
          } catch (err) {
            options.logger?.debug('neighbour refresh skipped unreadable file', {
              path: repoPath,
              reason: (err as Error).message,
            });
            return false;
          }
          return summarizeOne(
            options,
            repoPath,
            nextManifest.files[repoPath] as string,
            bytes.toString('utf8'),
            today,
          );
        }),
      );
      batch.forEach((repoPath, j) => {
        if (results[j] === true) refreshed.push(repoPath);
      });
    }
  }

  const path = manifestPath(options.brainDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  options.logger?.debug('codemap updated', {
    summarized: summarized.length,
    removed: removed.length,
    orphaned: orphaned.length,
    refreshed: refreshed.length,
    unchanged,
    total: currentFiles.length,
  });
  return {
    summarized,
    removed,
    orphaned,
    refreshed,
    unchanged,
    total: currentFiles.length,
  };
}

/**
 * Deletes every entry file whose repo path is not in `keep`, then prunes
 * directories left empty (bottom-up). Returns the swept repo paths. Delete
 * failures are logged with a reason and left for the next run — never silent
 * (CLAUDE.md), and the failure is visible in the log even though the stale
 * entry keeps serving until a sweep succeeds.
 */
function sweepOrphanEntries(
  brainDir: string,
  keep: ReadonlySet<string>,
  logger?: Logger,
): string[] {
  const root = join(brainDir, CODEMAP_DIR, FILES_DIR);
  if (!existsSync(root)) return [];
  const swept: string[] = [];
  /** Walks one directory; returns true when it is empty afterwards. */
  const walk = (dir: string, rel: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger?.debug('codemap sweep could not read directory', {
        dir: rel === '' ? '.' : rel,
        reason: (err as Error).message,
      });
      return false;
    }
    let remaining = 0;
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (walk(absolute, childRel)) {
          try {
            rmdirSync(absolute);
          } catch (err) {
            logger?.debug('codemap sweep could not prune empty directory', {
              dir: childRel,
              reason: (err as Error).message,
            });
            remaining += 1;
          }
        } else {
          remaining += 1;
        }
        continue;
      }
      if (!entry.name.endsWith('.md')) {
        remaining += 1;
        continue;
      }
      const repoPath = childRel.slice(0, -'.md'.length);
      if (keep.has(repoPath)) {
        remaining += 1;
        continue;
      }
      try {
        rmSync(absolute);
        swept.push(repoPath);
      } catch (err) {
        logger?.debug('codemap sweep failed to delete stale entry', {
          path: repoPath,
          reason: (err as Error).message,
        });
        remaining += 1;
      }
    }
    return remaining === 0;
  };
  walk(root, '');
  return swept.sort();
}

/** Reads every codemap entry (for indexing); unparseable files are skipped. */
export function readCodemapEntries(
  brainDir: string,
  logger?: Logger,
): Array<{ path: string; hash: string; updated: string; body: string }> {
  const root = join(brainDir, CODEMAP_DIR, FILES_DIR);
  if (!existsSync(root)) return [];
  const out: Array<{
    path: string;
    hash: string;
    updated: string;
    body: string;
  }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      try {
        const parsed = parseCodemapEntry(readFileSync(full, 'utf8'));
        out.push({ ...parsed.frontmatter, body: parsed.body });
      } catch (err) {
        logger?.debug('skipping unparseable codemap entry', {
          path: full,
          reason: (err as Error).message,
        });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
