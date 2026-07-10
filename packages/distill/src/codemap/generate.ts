import { createHash } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
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
}

export interface CodemapUpdateResult {
  /** Repo-relative paths (posix) re-summarized this run. */
  summarized: string[];
  /** Paths whose entries were removed (source file gone). */
  removed: string[];
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

  // Entries for files that no longer exist (or fell out of filters) go away —
  // the staleness guarantee: nothing serves beyond one update cycle.
  const currentSet = new Set(currentFiles);
  const removed: string[] = [];
  for (const oldPath of Object.keys(manifest.files)) {
    if (currentSet.has(oldPath)) continue;
    rmSync(entryFilePath(options.brainDir, oldPath), { force: true });
    removed.push(oldPath);
  }

  const path = manifestPath(options.brainDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  options.logger?.debug('codemap updated', {
    summarized: summarized.length,
    removed: removed.length,
    unchanged,
    total: currentFiles.length,
  });
  return { summarized, removed, unchanged, total: currentFiles.length };
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
