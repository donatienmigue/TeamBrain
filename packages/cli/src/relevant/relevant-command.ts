import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools, openBackend } from '@teambrain/mcp';

// E4.1 `tb relevant` (amendment B): the first human query path into the brain —
// a person can ask "which memories touch this change?" without an agent. Reads
// over the existing RetrievalBackend (C4) via memorySearch, which already
// applies the active/scope/retired filters (C4/R5), so a retired memory can
// never surface here. Read-only; adds no MCP tool. Fails open (exit 0, empty)
// so the review Action posts nothing when there is no brain or no match.

export interface RelevantRow {
  id: string;
  title: string;
  class: string;
}

export interface RelevantOptions {
  paths?: string[];
  query?: string;
  k?: number;
  json?: boolean;
  brainDir?: string;
  /** Index location; defaults to an ephemeral dir (CI has no daemon). */
  runtimeDir?: string;
}

/** Lexical query from changed paths (segmented) plus optional free text. */
export function buildQuery(
  paths: readonly string[],
  query: string | undefined,
): string {
  const tokens = paths
    .flatMap((p) => p.split(/[\\/._-]+/))
    .filter((t) => t.length > 1);
  return [query ?? '', ...tokens].join(' ').replace(/\s+/g, ' ').trim();
}

export async function runRelevantCommand(
  repoDir: string,
  options: RelevantOptions = {},
): Promise<{ exitCode: 0 | 1; output: string }> {
  const emptyOut = options.json === true ? '[]\n' : 'No relevant memories.\n';
  const brainDir = options.brainDir ?? join(repoDir, '.teambrain');
  if (!existsSync(brainDir)) return { exitCode: 0, output: emptyOut };

  const query = buildQuery(options.paths ?? [], options.query);
  if (query === '') return { exitCode: 0, output: emptyOut };

  const ephemeral =
    options.runtimeDir === undefined
      ? mkdtempSync(join(tmpdir(), 'tb-relevant-'))
      : null;
  const runtimeDir = options.runtimeDir ?? (ephemeral as string);
  const handle = await openBackend({ runtimeDir, brainDir, embedder: null });
  try {
    const tools = createTools(handle.context);
    const results = await tools.memorySearch({ query, k: options.k ?? 5 });
    const rows: RelevantRow[] = results.map((r) => ({
      id: r.id,
      title: r.title,
      class: r.class ?? 'memory',
    }));
    if (options.json === true) {
      return { exitCode: 0, output: `${JSON.stringify(rows, null, 2)}\n` };
    }
    if (rows.length === 0) return { exitCode: 0, output: emptyOut };
    let out = `Relevant memories (${rows.length}):\n`;
    for (const r of rows) out += `  - [${r.class}] ${r.title} (${r.id})\n`;
    return { exitCode: 0, output: out };
  } finally {
    handle.close();
    if (ephemeral !== null) {
      try {
        rmSync(ephemeral, { recursive: true, force: true });
      } catch {
        // Windows can briefly hold the sqlite handle; the OS reaps it.
      }
    }
  }
}
