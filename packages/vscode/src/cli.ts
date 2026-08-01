import { join } from 'node:path';

// Where the `tb` executable comes from. The extension never bundles native
// modules (better-sqlite3 / sqlite-vec / fastembed compile against a Node ABI
// that does not match Electron's) — it spawns the already-published
// `@teambrain/cli` as a child-process stdio MCP server instead. So resolving
// the CLI is the extension's only real piece of environment logic, and it is
// pure so it can be tested without a VS Code host.

/** Filesystem/PATH probes, injected so this module stays pure. */
export interface CliLookup {
  fileExists(path: string): boolean;
  /** Absolute path of `command` on PATH, or undefined. */
  onPath(command: string): string | undefined;
}

export type CliSource = 'setting' | 'workspace' | 'path';

export type CliResolution =
  { found: true; command: string; source: CliSource } | { found: false };

export interface ResolveCliOptions {
  /** `teambrain.cliPath` — an explicit path always wins. */
  configured?: string | undefined;
  /** Absolute workspace folder paths, in VS Code's order. */
  workspaceFolders: readonly string[];
  lookup: CliLookup;
  /** `process.platform`; only affects the Windows `.cmd` shim name. */
  platform?: string;
}

/** Local `node_modules/.bin` shim names for a workspace-installed CLI. */
function binNames(platform: string): string[] {
  return platform === 'win32' ? ['tb.cmd', 'tb.exe', 'tb'] : ['tb'];
}

/**
 * Resolution order, most explicit first:
 *   1. the `teambrain.cliPath` setting (honoured even if the file is absent,
 *      so a typo surfaces as a launch error the user can act on rather than
 *      being silently overridden by a different `tb` on PATH);
 *   2. a workspace-local `node_modules/.bin/tb` — a repo that pins the CLI
 *      as a devDependency should use the pinned version, not the global one;
 *   3. `tb` on PATH (the documented `npm i -g @teambrain/cli` install).
 */
export function resolveCli(options: ResolveCliOptions): CliResolution {
  const { configured, workspaceFolders, lookup } = options;
  const platform = options.platform ?? process.platform;

  const trimmed = configured?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return { found: true, command: trimmed, source: 'setting' };
  }

  for (const folder of workspaceFolders) {
    for (const name of binNames(platform)) {
      const candidate = join(folder, 'node_modules', '.bin', name);
      if (lookup.fileExists(candidate)) {
        return { found: true, command: candidate, source: 'workspace' };
      }
    }
  }

  const onPath = lookup.onPath('tb');
  if (onPath !== undefined) {
    return { found: true, command: onPath, source: 'path' };
  }

  return { found: false };
}

/** The command we tell the user to run when no CLI is found. */
export const CLI_INSTALL_COMMAND = 'npm install -g @teambrain/cli';
