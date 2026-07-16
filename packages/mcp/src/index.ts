export {
  resolveRuntimeDir,
  daemonSocketPath,
  pidFilePath,
  heartbeatPath,
  indexDbPath,
  candidateSpoolDir,
  feedbackSpoolPath,
  sessionSpoolDir,
  sessionRecordPath,
} from './paths.js';
// User-scope paths live in their own module (never in paths.ts): the sync
// code imports paths.js, and the C7 separation test asserts its import
// graph cannot name the user/ store.
export { userScopeDir, ensureUserScopeDir } from './user-paths.js';
export {
  Spool,
  SESSIONS_BRANCH,
  DEFAULT_SPOOL_CAP_BYTES,
  type SpoolOptions,
} from './spool.js';
export {
  toMemoryView,
  renderMemoryBlock,
  bundleTokens,
  type MemoryView,
} from './render.js';
export {
  CONTEXT_TOKEN_BUDGET,
  SESSION_CONTEXT_MAX_CHARS,
  CODEMAP_CHAR_SHARE,
  CODEMAP_INDEX_MAX_TOKENS,
  CODEMAP_SCOPED_TOKEN_BUDGET,
  buildMemoryContext,
  renderContextBundle,
  renderCodemapIndexBlock,
  type MemoryContext,
  type ContextBackend,
} from './context.js';
export {
  writeCandidate,
  recordFeedback,
  type QueuedCandidate,
} from './candidates.js';
export {
  createTools,
  DEFAULT_SEARCH_K,
  memorySearchInput,
  memoryProposeInput,
  memoryFeedbackInput,
  type Tools,
  type ToolContext,
  type MemoryBackend,
  type ProposeResult,
  type FeedbackResult,
} from './tools.js';
export {
  MCP_SERVER_NAME,
  createMcpServer,
  runMcpServer,
} from './mcp-server.js';
export {
  openBackend,
  type OpenBackendOptions,
  type BackendHandle,
} from './runtime.js';
export {
  startDaemon,
  type StartDaemonOptions,
  type DaemonHandle,
} from './daemon.js';
export {
  requestSessionContext,
  sendHookEvent,
  pingDaemon,
  HOOK_CLIENT_TIMEOUT_MS,
} from './hook-client.js';
export {
  ensureDaemon,
  AUTOSTART_DEADLINE_MS,
  AUTOSTART_LOCK_TTL_MS,
  AUTOSTART_PROBE_TIMEOUT_MS,
  AUTOSTART_MAX_FAILURES,
  AUTOSTART_RETRY_COOLDOWN_MS,
  type EnsureDaemonOptions,
} from './ensure-daemon.js';
export {
  runSessionStartHook,
  type SessionStartHookOptions,
} from './session-start-hook.js';
export {
  daemonRequestSchema,
  daemonResponseSchema,
  encodeMessage,
  type DaemonRequest,
  type DaemonResponse,
} from './protocol.js';
