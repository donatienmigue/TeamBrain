import { basename, join } from 'node:path';
import type { CliResolution } from './cli.js';

// The data half of `vscode.lm.registerMcpServerDefinitionProvider`: given the
// resolved CLI and the open workspace folders, decide which stdio servers to
// hand VS Code. Pure — extension.ts turns each record into an
// `McpStdioServerDefinition`.

/** C3 server name; matches what `tb install` writes for every other vendor. */
export const MCP_SERVER_LABEL = 'TeamBrain';

/** Adapter id passed as `--client`, so C2 events are tagged `vscode`. */
export const MCP_CLIENT_ID = 'vscode';

export interface StdioServerRecord {
  /** Unique per definition — VS Code shows this in the MCP servers view. */
  label: string;
  command: string;
  args: string[];
  /** Working directory: the workspace folder holding the brain. */
  cwd: string;
}

export interface WorkspaceFolderState {
  /** Absolute path. */
  path: string;
  /** Does `<path>/.teambrain/` exist? */
  hasBrain: boolean;
}

export interface BuildServerRecordsOptions {
  cli: CliResolution;
  folders: readonly WorkspaceFolderState[];
}

/** `<folder>/.teambrain` — the brain directory the daemon and CLI watch (C7). */
export function brainDir(folderPath: string): string {
  return join(folderPath, '.teambrain');
}

/**
 * One server per workspace folder that actually has a brain.
 *
 * Folders without `.teambrain/` are skipped deliberately: `tb mcp` would start
 * and serve an empty result set, which looks like a broken server rather than
 * "this repo has no brain yet". The provider re-fires its change event when a
 * brain appears, so `tb init` is picked up without a reload.
 *
 * The repo path is passed positionally *and* as `cwd` — the positional
 * argument is what `tb mcp [path]` resolves the brain from, and matching `cwd`
 * keeps git operations inside the right repo in multi-root workspaces.
 */
export function buildServerRecords(
  options: BuildServerRecordsOptions,
): StdioServerRecord[] {
  const { cli, folders } = options;
  if (!cli.found) return [];

  const withBrain = folders.filter((folder) => folder.hasBrain);
  const multi = withBrain.length > 1;

  return withBrain.map((folder) => ({
    label: multi
      ? `${MCP_SERVER_LABEL} (${basename(folder.path)})`
      : MCP_SERVER_LABEL,
    command: cli.command,
    args: ['mcp', folder.path, '--client', MCP_CLIENT_ID],
    cwd: folder.path,
  }));
}
