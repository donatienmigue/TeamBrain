import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import DatabaseConstructor, { type Database } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { z } from 'zod';
import type { Logger } from '@teambrain/core';
import type { Embedder } from './embeddings.js';
import {
  DOC_SOURCES,
  indexableDocSchema,
  type DocSource,
  type IndexableDoc,
  type IndexStats,
  type RetrievalBackend,
  type Scored,
  type SearchOptions,
} from './types.js';
import {
  LEXICAL_TOP_N,
  VECTOR_TOP_N,
  applyTokenBudget,
  isExpired,
  rrfFuse,
  toFtsMatchExpression,
} from './search-pipeline.js';

// M3.1 store. Git is the source of truth; this SQLite file is a rebuildable
// cache (~/.teambrain/index.db, C7) — every code path here may assume it can
// be deleted and rebuilt from the brain tree without losing anything.

export function defaultIndexDbPath(): string {
  return join(homedir(), '.teambrain', 'index.db');
}

const META_EMBEDDER_ID = 'embedder_id';
const META_VECTOR_DIM = 'vector_dim';
const META_BRAIN_CHECKSUM = 'brain_checksum';
const META_CODEMAP_CHECKSUM = 'codemap_checksum';

interface DocRow {
  rowid: number;
  id: string;
  source: string;
  title: string;
  body: string;
  class: string | null;
  scope: string | null;
  status: string;
  priority: string;
  created: string | null;
  ttl_days: number | null;
  tags: string;
  path: string | null;
}

function toScored(row: DocRow, score: number): Scored {
  return {
    id: row.id,
    source: row.source as DocSource,
    title: row.title,
    body: row.body,
    ...(row.class === null ? {} : { class: row.class as Scored['class'] }),
    ...(row.scope === null ? {} : { scope: row.scope as Scored['scope'] }),
    priority: row.priority as Scored['priority'],
    tags: z.array(z.string()).parse(JSON.parse(row.tags)),
    ...(row.path === null ? {} : { path: row.path }),
    score,
  };
}

function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export interface OpenIndexOptions {
  /** Defaults to ~/.teambrain/index.db (C7). */
  dbPath?: string;
  /** Absent/null → lexical-only retrieval (principle 2 degrade path). */
  embedder?: Embedder | null;
  logger?: Logger;
}

export class SqliteIndex implements RetrievalBackend {
  private readonly db: Database;
  private readonly embedder: Embedder | null;
  private readonly logger: Logger | undefined;
  private vectorReady = false;

  private constructor(options: OpenIndexOptions) {
    const dbPath = options.dbPath ?? defaultIndexDbPath();
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseConstructor(dbPath);
    this.embedder = options.embedder ?? null;
    this.logger = options.logger;
  }

  /**
   * Opens (creating on demand) the index. Async because an embedder change
   * re-embeds existing docs so lexical and vector views never diverge.
   */
  static async open(options: OpenIndexOptions = {}): Promise<SqliteIndex> {
    const index = new SqliteIndex(options);
    try {
      index.initSchema();
      await index.reconcileEmbedder();
    } catch (err) {
      // Release the file handle before rethrowing: a corrupt index.db must
      // stay deletable so `tb reindex` can reset it (on Windows an open
      // handle locks the file and would block the recovery path).
      index.db.close();
      throw err;
    }
    return index;
  }

  private initSchema(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        class TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        priority TEXT NOT NULL DEFAULT 'advisory',
        created TEXT,
        ttl_days INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        path TEXT
      );
      CREATE INDEX IF NOT EXISTS docs_by_source ON docs(source);
    `);
    // The FTS5 mirror is a plain (non-external-content) table whose rowids
    // are kept equal to docs rowids by the write paths below; a mirror copy
    // is simpler to keep provably consistent than external-content sync.
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts
      USING fts5(title, body, tags, tokenize = 'porter unicode61');
    `);
    if (this.embedder !== null) {
      try {
        sqliteVec.load(this.db);
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec
          USING vec0(embedding float[${this.embedder.dim}]);
        `);
        this.vectorReady = true;
      } catch (err) {
        // Principle 2: vector search degrades to lexical-only, never fails.
        this.vectorReady = false;
        this.logger?.debug(
          'sqlite-vec unavailable; degrading to lexical-only retrieval',
          { reason: (err as Error).message },
        );
      }
    }
  }

  /** Rebuilds the vec0 table when the embedder identity or dim changed. */
  private async reconcileEmbedder(): Promise<void> {
    if (!this.vectorReady || this.embedder === null) return;
    const storedId = this.getMeta(META_EMBEDDER_ID);
    const storedDim = this.getMeta(META_VECTOR_DIM);
    const current = this.embedder;
    if (storedId === current.id && storedDim === String(current.dim)) return;

    this.db.exec('DROP TABLE IF EXISTS docs_vec;');
    this.db.exec(`
      CREATE VIRTUAL TABLE docs_vec
      USING vec0(embedding float[${current.dim}]);
    `);
    const rows = this.db.prepare('SELECT rowid, * FROM docs').all() as DocRow[];
    if (rows.length > 0) {
      this.logger?.debug('embedder changed; re-embedding indexed docs', {
        from: storedId,
        to: current.id,
        docs: rows.length,
      });
      await this.insertVectors(rows);
    }
    this.setMeta(META_EMBEDDER_ID, current.id);
    this.setMeta(META_VECTOR_DIM, String(current.dim));
  }

  private getMeta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta(key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  get brainChecksum(): string | null {
    return this.getMeta(META_BRAIN_CHECKSUM);
  }

  setBrainChecksum(checksum: string): void {
    this.setMeta(META_BRAIN_CHECKSUM, checksum);
  }

  get codemapChecksum(): string | null {
    return this.getMeta(META_CODEMAP_CHECKSUM);
  }

  setCodemapChecksum(checksum: string | null): void {
    if (checksum === null) {
      this.db
        .prepare('DELETE FROM meta WHERE key = ?')
        .run(META_CODEMAP_CHECKSUM);
      return;
    }
    this.setMeta(META_CODEMAP_CHECKSUM, checksum);
  }

  private async insertVectors(
    rows: ReadonlyArray<Pick<DocRow, 'rowid' | 'title' | 'body'>>,
  ): Promise<void> {
    if (!this.vectorReady || this.embedder === null || rows.length === 0) {
      return;
    }
    const vectors = await this.embedder.embedDocs(
      rows.map((row) => `${row.title}\n${row.body}`),
    );
    const deleteVec = this.db.prepare('DELETE FROM docs_vec WHERE rowid = ?');
    const insertVec = this.db.prepare(
      'INSERT INTO docs_vec(rowid, embedding) VALUES (?, ?)',
    );
    const writeAll = this.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        // vec0 rejects JS-number bindings on its rowid; it wants int64.
        const rowid = BigInt((rows[i] as DocRow).rowid);
        deleteVec.run(rowid);
        insertVec.run(rowid, vectorToBlob(vectors[i] as Float32Array));
      }
    });
    writeAll();
  }

  async index(docs: IndexableDoc[], source: DocSource): Promise<void> {
    const validated = docs.map((doc) => indexableDocSchema.parse(doc));
    const upsertDoc = this.db.prepare(`
      INSERT INTO docs(id, source, title, body, class, scope, status,
                       priority, created, ttl_days, tags, path)
      VALUES (@id, @source, @title, @body, @class, @scope, @status,
              @priority, @created, @ttl_days, @tags, @path)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source, title = excluded.title,
        body = excluded.body, class = excluded.class,
        scope = excluded.scope, status = excluded.status,
        priority = excluded.priority, created = excluded.created,
        ttl_days = excluded.ttl_days, tags = excluded.tags,
        path = excluded.path
    `);
    const findRowid = this.db.prepare('SELECT rowid FROM docs WHERE id = ?');
    const deleteFts = this.db.prepare('DELETE FROM docs_fts WHERE rowid = ?');
    const insertFts = this.db.prepare(
      'INSERT INTO docs_fts(rowid, title, body, tags) VALUES (?, ?, ?, ?)',
    );

    const rowids: number[] = [];
    const writeRows = this.db.transaction(() => {
      for (const doc of validated) {
        upsertDoc.run({
          id: doc.id,
          source,
          title: doc.title,
          body: doc.body,
          class: doc.class ?? null,
          scope: doc.scope ?? null,
          status: doc.status ?? 'active',
          priority: doc.priority ?? 'advisory',
          created: doc.created ?? null,
          ttl_days: doc.ttl_days ?? null,
          tags: JSON.stringify(doc.tags ?? []),
          path: doc.path ?? null,
        });
        const { rowid } = findRowid.get(doc.id) as { rowid: number };
        deleteFts.run(rowid);
        insertFts.run(rowid, doc.title, doc.body, (doc.tags ?? []).join(' '));
        rowids.push(rowid);
      }
    });
    writeRows();

    await this.insertVectors(
      rowids.map((rowid, i) => ({
        rowid,
        title: (validated[i] as IndexableDoc).title,
        body: (validated[i] as IndexableDoc).body,
      })),
    );
  }

  async remove(ids: string[]): Promise<void> {
    const findRowid = this.db.prepare('SELECT rowid FROM docs WHERE id = ?');
    const deleteDoc = this.db.prepare('DELETE FROM docs WHERE rowid = ?');
    const deleteFts = this.db.prepare('DELETE FROM docs_fts WHERE rowid = ?');
    const deleteVec = this.vectorReady
      ? this.db.prepare('DELETE FROM docs_vec WHERE rowid = ?')
      : null;
    const removeAll = this.db.transaction(() => {
      for (const id of ids) {
        const row = findRowid.get(id) as { rowid: number } | undefined;
        if (row === undefined) continue;
        deleteDoc.run(row.rowid);
        deleteFts.run(row.rowid);
        deleteVec?.run(BigInt(row.rowid));
      }
    });
    removeAll();
    return Promise.resolve();
  }

  /** Transactional full replacement of one source (used by brain sync). */
  async replaceSource(source: DocSource, docs: IndexableDoc[]): Promise<void> {
    const staleIds = (
      this.db
        .prepare('SELECT id FROM docs WHERE source = ?')
        .all(source) as Array<{ id: string }>
    ).map((row) => row.id);
    await this.remove(staleIds);
    await this.index(docs, source);
  }

  async search(q: string, k: number, sources?: DocSource[]): Promise<Scored[]> {
    return this.searchWithOptions(q, k, sources ? { sources } : {});
  }

  /**
   * The C4 pipeline: BM25 top-40 ∪ vector top-40 → RRF(k=60) → filters
   * (active, scope, TTL) → required force-include → token-budget trim.
   * Required docs order first (fused score desc among them) and are exempt
   * from both the k cut and the token trim.
   */
  async searchWithOptions(
    q: string,
    k: number,
    options: SearchOptions = {},
  ): Promise<Scored[]> {
    const now = options.now ?? new Date();
    const sources = options.sources ?? [...DOC_SOURCES];
    const includeRequired =
      options.includeRequired ?? options.tokenBudget !== undefined;

    const useLexical = options.channels?.lexical ?? true;
    const useVector = options.channels?.vector ?? true;
    const lexicalRowids = useLexical ? this.lexicalTopN(q, sources) : [];
    const vectorRowids = useVector ? await this.vectorTopN(q) : [];
    const fusedScores = rrfFuse(
      [lexicalRowids, vectorRowids],
      undefined,
      options.fusionWeights === undefined
        ? undefined
        : [options.fusionWeights.lexical, options.fusionWeights.vector],
    );

    const passesFilters = (row: DocRow): boolean =>
      sources.includes(row.source as DocSource) &&
      row.status === 'active' &&
      (options.scope === undefined || row.scope === options.scope) &&
      !isExpired(row.created ?? undefined, row.ttl_days, now);

    const candidateRowids = [...fusedScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rowid]) => rowid);
    const hydrate = this.db.prepare(
      'SELECT rowid, * FROM docs WHERE rowid = ?',
    );
    const matched: Scored[] = [];
    const matchedIds = new Set<string>();
    for (const rowid of candidateRowids) {
      const row = hydrate.get(rowid) as DocRow | undefined;
      if (row === undefined || !passesFilters(row)) continue;
      matched.push(toScored(row, fusedScores.get(rowid) as number));
      matchedIds.add(row.id);
    }

    let results: Scored[];
    if (includeRequired) {
      // Force-include stage: every active, in-scope, unexpired required doc
      // is present, whether or not it matched the query.
      const requiredRows = (
        this.db
          .prepare(
            "SELECT rowid, * FROM docs WHERE priority = 'required' " +
              "AND status = 'active' ORDER BY created DESC, id",
          )
          .all() as DocRow[]
      ).filter(passesFilters);
      const required: Scored[] = [];
      const requiredIds = new Set<string>();
      for (const row of requiredRows) {
        requiredIds.add(row.id);
        const matchedDoc = matched.find((doc) => doc.id === row.id);
        required.push(matchedDoc ?? toScored(row, 0));
      }
      required.sort((a, b) => b.score - a.score);
      const advisory = matched.filter((doc) => !requiredIds.has(doc.id));
      // In context-assembly mode k caps the advisory tail; the token budget
      // (not k) is what ultimately bounds the bundle.
      results = [...required, ...advisory.slice(0, k)];
    } else {
      results = matched.slice(0, k);
    }

    if (options.tokenBudget !== undefined) {
      results = applyTokenBudget(results, options.tokenBudget);
    }
    return results;
  }

  /**
   * Query-less context assembly for `memory_context` (C3): every active,
   * in-scope, unexpired doc, required-first then newest-first, trimmed to
   * `tokenBudget` (required docs are exempt from the trim). No FTS/vector
   * ranking runs — there is no query, so recency is the ordering signal.
   */
  contextDocs(
    options: {
      sources?: DocSource[];
      scope?: 'team' | 'org';
      tokenBudget?: number;
      now?: Date;
    } = {},
  ): Scored[] {
    const now = options.now ?? new Date();
    const sources = options.sources ?? [...DOC_SOURCES];
    const placeholders = sources.map(() => '?').join(', ');
    // required before advisory, then newest first; id breaks date ties so
    // the ordering is deterministic across processes.
    const rows = this.db
      .prepare(
        `SELECT rowid, * FROM docs
         WHERE status = 'active' AND source IN (${placeholders})
         ORDER BY CASE priority WHEN 'required' THEN 0 ELSE 1 END,
                  created DESC, id`,
      )
      .all(...sources) as DocRow[];
    const scored = rows
      .filter(
        (row) =>
          (options.scope === undefined || row.scope === options.scope) &&
          !isExpired(row.created ?? undefined, row.ttl_days, now),
      )
      .map((row) => toScored(row, 0));
    return options.tokenBudget === undefined
      ? scored
      : applyTokenBudget(scored, options.tokenBudget);
  }

  private lexicalTopN(q: string, sources: DocSource[]): number[] {
    const matchExpression = toFtsMatchExpression(q);
    if (matchExpression === null) return [];
    const placeholders = sources.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT f.rowid AS rowid FROM docs_fts f
         JOIN docs d ON d.rowid = f.rowid
         WHERE docs_fts MATCH ? AND d.source IN (${placeholders})
         ORDER BY rank LIMIT ?`,
      )
      .all(matchExpression, ...sources, LEXICAL_TOP_N) as Array<{
      rowid: number;
    }>;
    return rows.map((row) => row.rowid);
  }

  private async vectorTopN(q: string): Promise<number[]> {
    if (!this.vectorReady || this.embedder === null) return [];
    // A query with no indexable token embeds to (near-)nothing; KNN would
    // still return arbitrary nearest docs, so skip the vector arm entirely.
    if (toFtsMatchExpression(q) === null) return [];
    const queryVector = await this.embedder.embedQuery(q);
    // Source filtering happens post-fusion: vec0 carries no metadata
    // columns, and V1 only ever indexes source 'memory' anyway.
    const rows = this.db
      .prepare(
        'SELECT rowid FROM docs_vec WHERE embedding MATCH ? AND k = ? ' +
          'ORDER BY distance',
      )
      .all(vectorToBlob(queryVector), VECTOR_TOP_N) as Array<{
      rowid: number;
    }>;
    return rows.map((row) => row.rowid);
  }

  stats(): IndexStats {
    const bySource = { memory: 0, codemap: 0 } as Record<DocSource, number>;
    const sourceRows = this.db
      .prepare('SELECT source, COUNT(*) AS n FROM docs GROUP BY source')
      .all() as Array<{ source: string; n: number }>;
    for (const row of sourceRows) {
      if ((DOC_SOURCES as readonly string[]).includes(row.source)) {
        bySource[row.source as DocSource] = row.n;
      }
    }
    const vectorCount = this.vectorReady
      ? (
          this.db.prepare('SELECT COUNT(*) AS n FROM docs_vec').get() as {
            n: number;
          }
        ).n
      : 0;
    return {
      docCount: bySource.memory + bySource.codemap,
      bySource,
      vectorCount,
      vectorDim: this.vectorReady ? (this.embedder?.dim ?? null) : null,
      lexicalOnly: !this.vectorReady,
      brainChecksum: this.brainChecksum,
    };
  }

  close(): void {
    this.db.close();
  }
}

export function openIndex(
  options: OpenIndexOptions = {},
): Promise<SqliteIndex> {
  return SqliteIndex.open(options);
}
