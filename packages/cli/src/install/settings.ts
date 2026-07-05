// M4.3 `tb install claude-code`: idempotent edits to two project files.
// Hooks belong in .claude/settings.json; the MCP server belongs in .mcp.json
// (where the installed Claude Code reads project-scoped servers — see the
// DEVLOG note on the BUILD_PLAN's single-file wording). Every merge is a pure
// function returning the new object plus whether anything changed, so the
// command can promise "run twice → zero diff the second time".

/** The command the SessionStart hook runs. `tb` is expected on PATH. */
export const SESSION_START_HOOK_COMMAND = 'tb hook session-start';
/** The MCP server name (C3) and how to launch it. */
export const MCP_SERVER_KEY = 'teambrain';
export const MCP_SERVER_COMMAND = 'tb';
export const MCP_SERVER_ARGS = ['mcp'] as const;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface MergeResult {
  value: Json;
  changed: boolean;
}

/**
 * Ensures `.mcp.json` registers the teambrain server. Idempotent: a second
 * call with the already-registered server reports changed=false.
 */
export function ensureMcpServer(existing: Json): MergeResult {
  const desired = {
    command: MCP_SERVER_COMMAND,
    args: [...MCP_SERVER_ARGS],
  };
  const servers = asObject(existing['mcpServers']);
  const current = servers[MCP_SERVER_KEY];
  if (JSON.stringify(current) === JSON.stringify(desired)) {
    return { value: existing, changed: false };
  }
  return {
    value: {
      ...existing,
      mcpServers: { ...servers, [MCP_SERVER_KEY]: desired },
    },
    changed: true,
  };
}

function groupHasCommand(group: unknown, command: string): boolean {
  return asArray(asObject(group)['hooks']).some(
    (hook) => asObject(hook)['command'] === command,
  );
}

/**
 * Ensures `.claude/settings.json` has a SessionStart hook running the
 * TeamBrain context injector. Idempotent: if any existing SessionStart group
 * already runs the command, nothing changes (no duplicate is appended).
 */
export function ensureSessionStartHook(existing: Json): MergeResult {
  const hooks = asObject(existing['hooks']);
  const sessionStart = asArray(hooks['SessionStart']);
  if (
    sessionStart.some((group) =>
      groupHasCommand(group, SESSION_START_HOOK_COMMAND),
    )
  ) {
    return { value: existing, changed: false };
  }
  const newGroup = {
    hooks: [{ type: 'command', command: SESSION_START_HOOK_COMMAND }],
  };
  return {
    value: {
      ...existing,
      hooks: {
        ...hooks,
        SessionStart: [...sessionStart, newGroup],
      },
    },
    changed: true,
  };
}

/** Canonical JSON serialization used for both writing and diffing. */
export function serializeSettings(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * A minimal line-level diff (added/removed lines) — enough to show the user
 * what `tb install` will change without pulling in a diff dependency.
 */
export function lineDiff(before: string, after: string): string {
  const beforeLines = new Set(before.split('\n'));
  const afterLines = new Set(after.split('\n'));
  const out: string[] = [];
  for (const line of before.split('\n')) {
    if (!afterLines.has(line)) out.push(`- ${line}`);
  }
  for (const line of after.split('\n')) {
    if (!beforeLines.has(line)) out.push(`+ ${line}`);
  }
  return out.join('\n');
}
