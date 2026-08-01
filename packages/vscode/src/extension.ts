import { accessSync, constants, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { CLI_INSTALL_COMMAND, resolveCli, type CliResolution } from './cli.js';
import {
  MCP_CONFIG_RELATIVE_PATH,
  UnparsableConfigError,
  configSnippet,
  mergeMcpConfig,
} from './fallback-config.js';
import { detectRegistrationMode } from './host.js';
import {
  brainDir,
  buildServerRecords,
  type StdioServerRecord,
  type WorkspaceFolderState,
} from './server-definition.js';
import {
  STATUS_COMMAND,
  describeStatus,
  type ExtensionState,
  type RegistrationMode,
} from './status.js';

// The whole extension. Everything that can be decided without a VS Code host
// lives in the pure modules above and is unit-tested; this file is the thin
// adapter that reads the workspace, renders the status bar, and hands VS Code
// server definitions.
//
// Deliberately absent, and not oversights: no retrieval, no embeddings, no
// bundled native modules, no telemetry, no network calls. The extension's
// entire job is to point agent mode at the `tb` CLI the user already has.

/** Must match `contributes.mcpServerDefinitionProviders[0].id`. */
const PROVIDER_ID = 'teambrain.mcp';

let output: vscode.OutputChannel | undefined;

function log(message: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * PATH scan instead of spawning `which`/`where`: activation must not block on
 * a child process, and this runs on every refresh.
 */
function onPath(command: string): string | undefined {
  const raw = process.env['PATH'];
  if (raw === undefined) return undefined;
  const suffixes =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of raw.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, `${command}${suffix}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function workspaceFolders(): vscode.WorkspaceFolder[] {
  return [...(vscode.workspace.workspaceFolders ?? [])].filter(
    (folder) => folder.uri.scheme === 'file',
  );
}

function folderStates(): WorkspaceFolderState[] {
  return workspaceFolders().map((folder) => ({
    path: folder.uri.fsPath,
    hasBrain: existsSync(brainDir(folder.uri.fsPath)),
  }));
}

function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('teambrain')
    .get<boolean>('enabled', true);
}

function configuredCliPath(): string | undefined {
  const value = vscode.workspace
    .getConfiguration('teambrain')
    .get<string>('cliPath', '');
  return value.trim().length > 0 ? value : undefined;
}

function currentCli(folders: readonly WorkspaceFolderState[]): CliResolution {
  return resolveCli({
    configured: configuredCliPath(),
    workspaceFolders: folders.map((folder) => folder.path),
    lookup: { fileExists: isExecutableFile, onPath },
  });
}

function currentState(registration: RegistrationMode): ExtensionState {
  const folders = folderStates();
  const cli = currentCli(folders);
  const servers = isEnabled() ? buildServerRecords({ cli, folders }) : [];
  return { registration, cli, folders, servers };
}

function toDefinition(
  record: StdioServerRecord,
): vscode.McpStdioServerDefinition {
  const definition = new vscode.McpStdioServerDefinition(
    record.label,
    record.command,
    record.args,
  );
  definition.cwd = vscode.Uri.file(record.cwd);
  return definition;
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('TeamBrain');
  context.subscriptions.push(output);

  const registration = detectRegistrationMode(vscode.lm);
  log(
    registration === 'native'
      ? 'host implements the MCP registration API — registering servers'
      : 'host does not implement vscode.lm.registerMcpServerDefinitionProvider; ' +
          'falling back to a manual .vscode/mcp.json (Cursor, Windsurf, VSCodium)',
  );

  const statusItem = vscode.window.createStatusBarItem(
    'teambrain.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.name = 'TeamBrain';
  statusItem.command = STATUS_COMMAND;
  context.subscriptions.push(statusItem);

  const changeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(changeEmitter);

  let state = currentState(registration);

  const refresh = (reason: string): void => {
    const previous = JSON.stringify(state.servers);
    state = currentState(registration);
    renderStatus(statusItem, state);
    if (JSON.stringify(state.servers) !== previous) {
      log(
        `${reason}: serving ${String(state.servers.length)} brain(s) — refreshing MCP definitions`,
      );
      changeEmitter.fire();
    }
  };

  renderStatus(statusItem, state);

  if (registration === 'native') {
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: changeEmitter.event,
        provideMcpServerDefinitions: () => state.servers.map(toDefinition),
      }),
    );
  }

  // A brain can appear (`tb init`) or disappear after activation; the provider
  // change event is exactly what VS Code offers for that, so no reload needed.
  const watcher = vscode.workspace.createFileSystemWatcher('**/.teambrain/');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => refresh('brain created')),
    watcher.onDidDelete(() => refresh('brain removed')),
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      refresh('workspace folders changed'),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('teambrain')) refresh('settings changed');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(STATUS_COMMAND, () => {
      refresh('status requested');
      void showStatus(state);
    }),
    vscode.commands.registerCommand('teambrain.installCli', () => {
      installCli();
    }),
    vscode.commands.registerCommand('teambrain.writeMcpConfig', () =>
      writeMcpConfig(),
    ),
    vscode.commands.registerCommand('teambrain.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'teambrain.teambrain-vscode#teambrain.setup',
        false,
      ),
    ),
  );
}

export function deactivate(): void {
  output = undefined;
}

function renderStatus(item: vscode.StatusBarItem, state: ExtensionState): void {
  const view = describeStatus(state);
  item.text = view.text;
  item.tooltip = view.tooltip;
  item.backgroundColor =
    view.severity === 'warning'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  item.show();
}

async function showStatus(state: ExtensionState): Promise<void> {
  const view = describeStatus(state);
  const actions: string[] = [];
  if (!state.cli.found) actions.push('Install the CLI');
  if (state.registration === 'manual') actions.push('Write MCP config');
  actions.push('Open logs');

  const choice = await (view.severity === 'warning'
    ? vscode.window.showWarningMessage(view.tooltip, ...actions)
    : vscode.window.showInformationMessage(view.tooltip, ...actions));

  if (choice === 'Install the CLI') installCli();
  else if (choice === 'Write MCP config') await writeMcpConfig();
  else if (choice === 'Open logs') output?.show(true);
}

/**
 * Runs the install in a visible terminal rather than silently: this installs
 * software globally, and the user should see the command and its output.
 */
function installCli(): void {
  const terminal = vscode.window.createTerminal('TeamBrain — install CLI');
  terminal.show(true);
  terminal.sendText(CLI_INSTALL_COMMAND, false);
  void vscode.window.showInformationMessage(
    'Review the command in the terminal and press Enter to install the TeamBrain CLI.',
  );
}

/** Picks the folder to write `.vscode/mcp.json` into, prompting if ambiguous. */
async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = workspaceFolders();
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      'TeamBrain: open a folder first — there is nowhere to write the configuration.',
    );
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({
    placeHolder: 'Which folder should get .vscode/mcp.json?',
  });
}

async function writeMcpConfig(): Promise<void> {
  const folder = await pickFolder();
  if (folder === undefined) return;

  const target = join(
    folder.uri.fsPath,
    ...MCP_CONFIG_RELATIVE_PATH.split('/'),
  );
  let existing = '';
  try {
    existing = await readFile(target, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log(`could not read ${target}: ${String(code ?? err)}`);
      void vscode.window.showErrorMessage(
        `TeamBrain: cannot read ${MCP_CONFIG_RELATIVE_PATH} (${String(code ?? err)}).`,
      );
      return;
    }
  }

  let merged: { contents: string; changed: boolean };
  try {
    merged = mergeMcpConfig(existing);
  } catch (err) {
    if (!(err instanceof UnparsableConfigError)) throw err;
    // Never rewrite a file we could not parse — VS Code allows comments here.
    log(`${err.message}; offering the snippet instead`);
    const copy = await vscode.window.showWarningMessage(
      `TeamBrain: ${err.message}. Add the server entry by hand.`,
      'Copy snippet',
    );
    if (copy === 'Copy snippet') {
      await vscode.env.clipboard.writeText(configSnippet());
    }
    return;
  }

  if (!merged.changed) {
    void vscode.window.showInformationMessage(
      `TeamBrain: ${MCP_CONFIG_RELATIVE_PATH} is already configured.`,
    );
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, merged.contents, 'utf8');
  log(`wrote ${target}`);
  const open = await vscode.window.showInformationMessage(
    `TeamBrain: wrote ${MCP_CONFIG_RELATIVE_PATH}. Restart the MCP server in your editor to pick it up.`,
    'Open file',
  );
  if (open === 'Open file') {
    await vscode.window.showTextDocument(vscode.Uri.file(target));
  }
}
