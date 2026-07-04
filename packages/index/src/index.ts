export { DOC_SOURCES, indexableDocSchema } from './types.js';
export type {
  DocSource,
  IndexableDoc,
  IndexStats,
  RetrievalBackend,
  Scored,
  SearchOptions,
} from './types.js';
export {
  LEXICAL_TOP_N,
  VECTOR_TOP_N,
  RRF_K,
  CHARS_PER_TOKEN,
  toFtsMatchExpression,
  rrfFuse,
  isExpired,
  estimateTokens,
  applyTokenBudget,
} from './search-pipeline.js';
export {
  EMBED_BATCH_SIZE,
  BGE_SMALL_EN_V15,
  HashingEmbedder,
  defaultModelsDir,
  l2Normalize,
  ensureModelFiles,
  createFastEmbedEmbedder,
  tryCreateFastEmbedEmbedder,
} from './embeddings.js';
export type {
  Embedder,
  ModelSpec,
  DownloadFn,
  EnsureModelOptions,
  FastEmbedOptions,
} from './embeddings.js';
export { SqliteIndex, openIndex, defaultIndexDbPath } from './store.js';
export type { OpenIndexOptions } from './store.js';
export {
  computeBrainChecksum,
  loadBrainDocs,
  syncIndexWithBrain,
} from './brain.js';
export type { SyncResult } from './brain.js';
