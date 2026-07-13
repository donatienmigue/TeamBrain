// Compatibility shim: the pure merge functions moved into @teambrain/hooks
// with the A0 CaptureAdapter extraction — each adapter now owns its install
// merges (claude-code: hooks + MCP; cursor: MCP + rules). Re-exported here so
// existing imports and the M4.3 tests stay valid, unchanged.

export {
  CAPTURE_HOOKS,
  SESSION_START_HOOK_COMMAND,
  MCP_SERVER_ARGS,
  MCP_SERVER_COMMAND,
  MCP_SERVER_KEY,
  ensureCaptureHooks,
  ensureCursorRules,
  ensureMcpServer,
  type HookSpec,
  type MergeResult,
} from '@teambrain/hooks';
export { lineDiff, serializeSettings } from './install-command.js';
