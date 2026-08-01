import { MCP_CLIENT_ID, MCP_SERVER_LABEL } from './server-definition.js';

// Stage-3 groundwork, and a correctness requirement rather than a nicety: the
// VSIX is published to Open VSX too, so it *installs* in Cursor, Windsurf and
// VSCodium — none of which implement `registerMcpServerDefinitionProvider`. In
// those hosts the extension has nothing to register, so it offers the same
// `.vscode/mcp.json` block `tb install vscode` writes. A test asserts the two
// stay byte-identical, so the fallback can never drift from the adapter.

/** Workspace-relative path VS Code reads MCP servers from. */
export const MCP_CONFIG_RELATIVE_PATH = '.vscode/mcp.json';

/** VS Code's root key. Claude Code's `mcpServers` is silently ignored here. */
const SERVERS_KEY = 'servers';

const SERVER_KEY = MCP_SERVER_LABEL.toLowerCase();

/**
 * The server entry. `${workspaceFolder}` is a VS Code variable, so the file
 * stays committable — no absolute path from whoever ran the command first.
 */
export function desiredServerEntry(): Record<string, unknown> {
  return {
    type: 'stdio',
    command: 'tb',
    args: ['mcp', '${workspaceFolder}', '--client', MCP_CLIENT_ID],
  };
}

/** Raised when the existing file cannot be merged without risking user data. */
export class UnparsableConfigError extends Error {
  constructor(reason: string) {
    super(
      `${MCP_CONFIG_RELATIVE_PATH} could not be parsed (${reason}) — refusing to overwrite it`,
    );
    this.name = 'UnparsableConfigError';
  }
}

export interface MergeOutcome {
  contents: string;
  changed: boolean;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Merges the TeamBrain server into an existing `.vscode/mcp.json`.
 *
 * Throws rather than rewrites when the file exists but is not plain JSON —
 * VS Code accepts comments in this file, and a JSON round-trip would delete
 * them along with anything else it could not represent. Losing a user's
 * config to a convenience command is worse than making them paste four lines.
 */
export function mergeMcpConfig(existingRaw: string): MergeOutcome {
  let existing: Record<string, unknown> = {};
  if (existingRaw.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingRaw);
    } catch (err) {
      throw new UnparsableConfigError(
        err instanceof Error ? err.message : String(err),
      );
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new UnparsableConfigError('expected a JSON object');
    }
    existing = parsed as Record<string, unknown>;
  }

  const servers = asObject(existing[SERVERS_KEY]);
  const desired = desiredServerEntry();
  if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(desired)) {
    return { contents: existingRaw, changed: false };
  }

  const merged = {
    ...existing,
    [SERVERS_KEY]: { ...servers, [SERVER_KEY]: desired },
  };
  return { contents: `${JSON.stringify(merged, null, 2)}\n`, changed: true };
}

/** The snippet shown when the file cannot be merged automatically. */
export function configSnippet(): string {
  return `${JSON.stringify(
    { [SERVERS_KEY]: { [SERVER_KEY]: desiredServerEntry() } },
    null,
    2,
  )}\n`;
}
