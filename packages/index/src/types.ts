import { z } from 'zod';
import { memoryClassSchema, type MemoryClass } from '@teambrain/core';

// C4 RetrievalBackend contract types. V1 uses only source 'memory'; the
// 'codemap' tag is design-ahead for R16 and costs one field.

export const DOC_SOURCES = ['memory', 'codemap'] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

/**
 * A document handed to the index. For source 'memory' this is a projection
 * of a C1 memory file; the retrieval-relevant front-matter fields ride along
 * so the search pipeline can filter (active, scope, TTL) and force-include
 * required memories without re-reading the brain tree.
 */
export interface IndexableDoc {
  id: string;
  title: string;
  body: string;
  class?: MemoryClass;
  scope?: 'team' | 'org';
  status?: 'active' | 'retired';
  priority?: 'required' | 'advisory';
  /** ISO date (YYYY-MM-DD); anchors TTL expiry. */
  created?: string;
  ttl_days?: number | null;
  tags?: string[];
  /** Repo-relative path of the source file, for provenance. */
  path?: string;
}

// Boundary validation (repo rule: zod on all external input). Docs arrive
// from parsed brain files today, but C4 is a public interface.
export const indexableDocSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  class: memoryClassSchema.optional(),
  scope: z.enum(['team', 'org']).optional(),
  status: z.enum(['active', 'retired']).optional(),
  priority: z.enum(['required', 'advisory']).optional(),
  created: z.string().optional(),
  ttl_days: z.number().int().nullable().optional(),
  tags: z.array(z.string()).optional(),
  path: z.string().optional(),
}) satisfies z.ZodType<IndexableDoc>;

/** A search result. `source` is carried per C4. */
export interface Scored {
  id: string;
  source: DocSource;
  title: string;
  body: string;
  class?: MemoryClass;
  scope?: 'team' | 'org';
  priority: 'required' | 'advisory';
  tags: string[];
  path?: string;
  /** Fused RRF score; force-included docs that matched nothing carry 0. */
  score: number;
}

/**
 * R16.1: a cheap overview of the indexed codemap, powering the session-start
 * CodeMap index block. Derived entirely from doc paths — no bodies read.
 */
export interface CodemapStats {
  entryCount: number;
  /** Module names derived from entry paths, most entries first. */
  modules: string[];
  /** ISO date of the freshest entry, or null when the codemap is empty. */
  newestUpdated: string | null;
}

export interface IndexStats {
  docCount: number;
  bySource: Record<DocSource, number>;
  /** Rows in the vec0 table; 0 when running lexical-only. */
  vectorCount: number;
  /** Embedding dimension, or null when running lexical-only. */
  vectorDim: number | null;
  /** True when vector search is unavailable (no embedder or no sqlite-vec). */
  lexicalOnly: boolean;
  /** Last indexed brain-tree checksum, if a brain sync has run. */
  brainChecksum: string | null;
}

export interface SearchOptions {
  /** Restrict to these sources; default all. */
  sources?: DocSource[];
  /** Restrict to one scope; default both. */
  scope?: 'team' | 'org';
  /**
   * Token budget for the trim stage (est. 4 chars/token). Required docs are
   * never trimmed. Default: no trim.
   */
  tokenBudget?: number;
  /**
   * C4 force-include stage: inject every active `priority: required` doc
   * even when it matches nothing, ordered first and exempt from the k cut
   * and the token trim. Defaults to true when `tokenBudget` is set (context
   * assembly) and false for plain ranked search, where flooding the top-k
   * with non-matching required docs would bury actual hits.
   */
  includeRequired?: boolean;
  /** Injectable clock for TTL filtering; default `new Date()`. */
  now?: Date;
  /**
   * R10 eval-harness ablation: which retrieval channels run. Default both —
   * product paths never set this; it exists so `pnpm eval` can measure the
   * lexical and vector arms in isolation.
   */
  channels?: { lexical?: boolean; vector?: boolean };
  /**
   * R10 eval-harness ablation: weighted RRF fusion. Default 1/1, which is
   * exactly the shipped weightless RRF.
   */
  fusionWeights?: { lexical: number; vector: number };
}

export interface RetrievalBackend {
  index(docs: IndexableDoc[], source: DocSource): Promise<void>;
  search(q: string, k: number, sources?: DocSource[]): Promise<Scored[]>;
  remove(ids: string[]): Promise<void>;
  stats(): IndexStats;
}
