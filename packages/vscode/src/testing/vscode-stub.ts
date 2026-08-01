/* eslint-disable @typescript-eslint/no-explicit-any */
// A hand-written stand-in for the `vscode` module, aliased in by
// vitest.config.ts. It implements only what extension.ts touches, and records
// what was asked of it so the activation tests can assert on real behaviour
// (did it register a provider? what definitions did it hand back?) rather than
// on implementation details.
//
// It is excluded from the tsconfig build and from the VSIX — nothing here
// ships. `any` is confined to this file for the same reason the real API is
// untyped at the boundary: the stub deliberately mimics a host we do not own.

export interface StubState {
  workspaceFolders: Array<{ uri: { scheme: string; fsPath: string } }>;
  configuration: Record<string, unknown>;
  /** Set to false to emulate Cursor/Windsurf/VSCodium. */
  supportsMcpRegistration: boolean;
  registeredProviders: Array<{ id: string; provider: any }>;
  commands: Map<string, (...args: any[]) => any>;
  statusBarItems: any[];
  outputLines: string[];
  terminals: Array<{
    name: string;
    sent: Array<{ text: string; execute: boolean }>;
  }>;
  messages: Array<{ kind: 'info' | 'warning' | 'error'; text: string }>;
  /** Reply the next showXMessage resolves with, if any. */
  nextChoice?: string | undefined;
  clipboard: string;
  openedDocuments: string[];
  executedCommands: Array<{ command: string; args: unknown[] }>;
  watchers: Array<{
    pattern: string;
    onCreate: Array<() => void>;
    onDelete: Array<() => void>;
  }>;
  folderPick?: { uri: { scheme: string; fsPath: string } } | undefined;
}

export const state: StubState = freshState();

function freshState(): StubState {
  return {
    workspaceFolders: [],
    configuration: {},
    supportsMcpRegistration: true,
    registeredProviders: [],
    commands: new Map(),
    statusBarItems: [],
    outputLines: [],
    terminals: [],
    messages: [],
    nextChoice: undefined,
    clipboard: '',
    openedDocuments: [],
    executedCommands: [],
    watchers: [],
    folderPick: undefined,
  };
}

export function resetStub(): void {
  Object.assign(state, freshState());
  // `lm` is rebuilt because the MCP entry point is added/removed per host.
  applyRegistrationSupport();
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
  ) {}
  static file(path: string): Uri {
    return new Uri('file', path);
  }
}

export class EventEmitter<T> {
  private readonly listeners: Array<(value: T) => void> = [];
  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: (): void => {} };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
  dispose(): void {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class McpStdioServerDefinition {
  cwd?: Uri;
  env: Record<string, string | number | null> = {};
  version?: string;
  constructor(
    public readonly label: string,
    public command: string,
    public args: string[] = [],
  ) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export const window = {
  createOutputChannel() {
    return {
      appendLine: (line: string): void => void state.outputLines.push(line),
      show: (): void => {},
      dispose: (): void => {},
    };
  },
  createStatusBarItem() {
    const item: any = {
      name: '',
      text: '',
      tooltip: '',
      command: '',
      backgroundColor: undefined,
      shown: false,
      show(): void {
        item.shown = true;
      },
      hide(): void {
        item.shown = false;
      },
      dispose(): void {},
    };
    state.statusBarItems.push(item);
    return item;
  },
  createTerminal(name: string) {
    const terminal = {
      name,
      sent: [] as Array<{ text: string; execute: boolean }>,
    };
    state.terminals.push(terminal);
    return {
      show: (): void => {},
      // `addNewLine` defaults to true in the real API — recording it is the
      // point: the install command must never submit itself.
      sendText: (text: string, addNewLine = true): void =>
        void terminal.sent.push({ text, execute: addNewLine }),
      dispose: (): void => {},
    };
  },
  showInformationMessage(text: string) {
    state.messages.push({ kind: 'info', text });
    return Promise.resolve(state.nextChoice);
  },
  showWarningMessage(text: string) {
    state.messages.push({ kind: 'warning', text });
    return Promise.resolve(state.nextChoice);
  },
  showErrorMessage(text: string) {
    state.messages.push({ kind: 'error', text });
    return Promise.resolve(state.nextChoice);
  },
  showWorkspaceFolderPick() {
    return Promise.resolve(state.folderPick);
  },
  showTextDocument(uri: Uri) {
    state.openedDocuments.push(uri.fsPath);
    return Promise.resolve({});
  },
};

export const workspace = {
  get workspaceFolders() {
    return state.workspaceFolders.length > 0
      ? state.workspaceFolders
      : undefined;
  },
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback: T): T {
        const value = state.configuration[`${section}.${key}`];
        return value === undefined ? fallback : (value as T);
      },
    };
  },
  createFileSystemWatcher(pattern: string) {
    const watcher = {
      pattern,
      onCreate: [] as Array<() => void>,
      onDelete: [] as Array<() => void>,
    };
    state.watchers.push(watcher);
    return {
      onDidCreate: (listener: () => void) => {
        watcher.onCreate.push(listener);
        return { dispose: (): void => {} };
      },
      onDidDelete: (listener: () => void) => {
        watcher.onDelete.push(listener);
        return { dispose: (): void => {} };
      },
      onDidChange: () => ({ dispose: (): void => {} }),
      dispose: (): void => {},
    };
  },
  onDidChangeWorkspaceFolders() {
    return { dispose: (): void => {} };
  },
  onDidChangeConfiguration() {
    return { dispose: (): void => {} };
  },
};

export const commands = {
  registerCommand(id: string, handler: (...args: any[]) => any) {
    state.commands.set(id, handler);
    return { dispose: (): void => void state.commands.delete(id) };
  },
  executeCommand(command: string, ...args: unknown[]) {
    state.executedCommands.push({ command, args });
    return Promise.resolve(undefined);
  },
};

export const env = {
  clipboard: {
    writeText(text: string) {
      state.clipboard = text;
      return Promise.resolve();
    },
  },
};

export const lm: { registerMcpServerDefinitionProvider?: unknown } = {};

function applyRegistrationSupport(): void {
  if (state.supportsMcpRegistration) {
    lm.registerMcpServerDefinitionProvider = (
      id: string,
      provider: unknown,
    ): { dispose(): void } => {
      state.registeredProviders.push({ id, provider });
      return { dispose: (): void => {} };
    };
  } else {
    delete lm.registerMcpServerDefinitionProvider;
  }
}

/** Emulate a fork without the registration API before calling `activate`. */
export function setMcpRegistrationSupport(supported: boolean): void {
  state.supportsMcpRegistration = supported;
  applyRegistrationSupport();
}

applyRegistrationSupport();
