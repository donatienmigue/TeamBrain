import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryFile } from '@teambrain/core';

// Loads the active memories a distill run must dedup/conflict-check against.
// Reads only `memories/` (never `retired/`): retired memories are absent from
// retrieval and must not resurrect a candidate as a "duplicate" or become a
// supersedes target (CONTRACTS C1; the R5 negative-test stance).

/** The projection of an existing memory the dedup stage needs. */
export interface ExistingMemory {
  id: string;
  title: string;
  body: string;
}

function* walkMarkdown(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMarkdown(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

/**
 * Loads active memories from `<brainDir>/memories/`. Files that no longer parse
 * are skipped rather than failing the run (they'd be caught by `tb lint`), and
 * a memory marked retired in place is excluded defensively.
 */
export function loadExistingMemories(brainDir: string): ExistingMemory[] {
  const memoriesDir = join(brainDir, 'memories');
  if (!existsSync(memoriesDir)) return [];

  const memories: ExistingMemory[] = [];
  for (const file of walkMarkdown(memoriesDir)) {
    try {
      const { frontmatter, body } = parseMemoryFile(readFileSync(file, 'utf8'));
      if (frontmatter.status !== 'active') continue;
      memories.push({ id: frontmatter.id, title: frontmatter.title, body });
    } catch {
      continue;
    }
  }
  return memories;
}
