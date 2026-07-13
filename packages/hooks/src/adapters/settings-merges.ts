import type { MergeResult } from '../adapter.js';

// Pure config-merge helpers shared by adapters (moved from
// packages/cli/src/install/settings.ts in the A0 framework extraction —
// the cli re-exports them, so behavior and tests are unchanged).

/** The MCP server name (C3) and how to launch it. */
export const MCP_SERVER_KEY = 'teambrain';
export const MCP_SERVER_COMMAND = 'tb';
export const MCP_SERVER_ARGS = ['mcp'] as const;

type Json = Record<string, unknown>;

export function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Ensures the target MCP config registers the teambrain server. Idempotent: a
 * second call with the already-registered server reports changed=false. When
 * `tool` names a Tier-B client, the server is launched with `--client <tool>`
 * so MCP-side session inference tags events with the right vendor.
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
