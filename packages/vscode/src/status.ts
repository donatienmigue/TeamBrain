import type { CliResolution } from './cli.js';
import { CLI_INSTALL_COMMAND } from './cli.js';
import type {
  StdioServerRecord,
  WorkspaceFolderState,
} from './server-definition.js';

// The status bar is the extension's only always-on surface, so it has to
// answer the three questions a broken setup raises — is the CLI there, is
// there a brain, did the host accept the registration — without opening a log.
// Pure: extension.ts renders the returned record onto a StatusBarItem.

/**
 * How this host registers MCP servers.
 * - `native`: `vscode.lm.registerMcpServerDefinitionProvider` exists (genuine
 *   VS Code 1.102+ with Copilot) — zero config.
 * - `manual`: the API is absent (Cursor, Windsurf, VSCodium and older VS
 *   Code). The extension cannot register anything; it offers to write
 *   `.vscode/mcp.json` instead.
 */
export type RegistrationMode = 'native' | 'manual';

export interface ExtensionState {
  registration: RegistrationMode;
  cli: CliResolution;
  folders: readonly WorkspaceFolderState[];
  servers: readonly StdioServerRecord[];
}

export interface StatusView {
  text: string;
  tooltip: string;
  severity: 'ok' | 'warning';
}

export const STATUS_COMMAND = 'teambrain.showStatus';

function cliLine(cli: CliResolution): string {
  if (!cli.found) return `CLI: not found — ${CLI_INSTALL_COMMAND}`;
  const origin = {
    setting: 'teambrain.cliPath',
    workspace: 'workspace node_modules',
    path: 'PATH',
  }[cli.source];
  return `CLI: ${cli.command} (${origin})`;
}

/**
 * Precedence is "what blocks you first": no CLI beats no brain beats a host
 * that cannot auto-register, because fixing them in the other order leaves the
 * user staring at a server that still will not start.
 */
export function describeStatus(state: ExtensionState): StatusView {
  const { cli, folders, servers, registration } = state;
  const brains = folders.filter((folder) => folder.hasBrain).length;

  if (!cli.found) {
    return {
      text: '$(warning) TeamBrain',
      severity: 'warning',
      tooltip: [
        'TeamBrain: the `tb` CLI was not found.',
        `Install it with \`${CLI_INSTALL_COMMAND}\`, or set \`teambrain.cliPath\`.`,
      ].join('\n'),
    };
  }

  if (folders.length === 0) {
    return {
      text: '$(warning) TeamBrain',
      severity: 'warning',
      tooltip: ['TeamBrain: no folder is open.', cliLine(cli)].join('\n'),
    };
  }

  if (brains === 0) {
    return {
      text: '$(warning) TeamBrain',
      severity: 'warning',
      tooltip: [
        'TeamBrain: no brain in this workspace.',
        'Run `tb init` to import your existing rules files into `.teambrain/`.',
        cliLine(cli),
      ].join('\n'),
    };
  }

  if (registration === 'manual') {
    return {
      text: '$(warning) TeamBrain',
      severity: 'warning',
      tooltip: [
        'TeamBrain: this editor does not implement VS Code’s MCP registration API,',
        'so the server cannot be registered automatically.',
        'Run “TeamBrain: Write MCP configuration” to add `.vscode/mcp.json`.',
        cliLine(cli),
      ].join('\n'),
    };
  }

  const served =
    servers.length === 1
      ? '1 brain served'
      : `${String(servers.length)} brains served`;
  return {
    text: '$(check) TeamBrain',
    severity: 'ok',
    tooltip: [
      `TeamBrain: MCP server registered (${served}).`,
      cliLine(cli),
      'Memories are proposed as pull requests — nothing is written to main by this extension.',
    ].join('\n'),
  };
}
