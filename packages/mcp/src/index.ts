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
  buildMemoryContext,
  renderContextBundle,
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
