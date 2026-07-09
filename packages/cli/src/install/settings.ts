// M4.3 `tb install claude-code`: idempotent edits to two project files.
// Hooks belong in .claude/settings.json; the MCP server belongs in .mcp.json
// (where the installed Claude Code reads project-scoped servers — see the
// DEVLOG note on the BUILD_PLAN's single-file wording). Every merge is a pure
// function returning the new object plus whether anything changed, so the
// command can promise "run twice → zero diff the second time".

/** The command the SessionStart hook runs. `tb` is expected on PATH. */
export const SESSION_START_HOOK_COMMAND = 'tb hook session-start';

export interface HookSpec {
  event: string;
  command: string;
  /** PostToolUse/Stop fire-and-forget; SessionStart injects context, so sync. */
  async: boolean;
}

/** The Claude Code hooks `tb install` registers (M4.3 + M5.2). */
export const CAPTURE_HOOKS: HookSpec[] = [
  { event: 'SessionStart', command: SESSION_START_HOOK_COMMAND, async: false },
  { event: 'PostToolUse', command: 'tb hook post-tool-use', async: true },
  { event: 'Stop', command: 'tb hook stop', async: true },
];

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
export function ensureMcpServer(existing: Json, tool?: string): MergeResult {
  const args: string[] = [...MCP_SERVER_ARGS];
  if (tool === 'cursor') args.push('--client', 'cursor');

  const desired = {
    command: MCP_SERVER_COMMAND,
    args,
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
 * Ensures `.claude/settings.json` registers every TeamBrain capture hook
 * (SessionStart, PostToolUse, Stop). Idempotent: an event whose group already
 * runs the command is left untouched, so no duplicates accumulate and a second
 * install is a no-op.
 */
export function ensureCaptureHooks(existing: Json): MergeResult {
  const hooks = asObject(existing['hooks']);
  let changed = false;
  for (const spec of CAPTURE_HOOKS) {
    const groups = asArray(hooks[spec.event]);
    if (groups.some((group) => groupHasCommand(group, spec.command))) continue;
    const command: Record<string, unknown> = {
      type: 'command',
      command: spec.command,
    };
    if (spec.async) command['async'] = true;
    hooks[spec.event] = [...groups, { hooks: [command] }];
    changed = true;
  }
  return changed
    ? { value: { ...existing, hooks }, changed: true }
    : { value: existing, changed: false };
}

export function ensureCursorRules(existingRaw: string): { value: string; changed: boolean } {
  const desired = `---
description: TeamBrain memory capture
globs: *
---
# TeamBrain Memory Rules
Always call \`mcp__teambrain__memory_context\` at the start of your work.
Always call \`mcp__teambrain__memory_propose\` at the end of your work if you learned something new.
`;
  if (existingRaw === desired) return { value: existingRaw, changed: false };
  return { value: desired, changed: true };
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
