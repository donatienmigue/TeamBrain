# TeamBrain for VS Code

Shared, reviewable memory for your coding agents — approved through pull
requests, stored as markdown in your repo.

This extension does one thing: it registers the TeamBrain MCP server with
Copilot agent mode so you never write a config file. Everything else — storage,
retrieval, capture, distillation — happens in the `tb` CLI as a local process.

## What you get

Once installed, agent mode can call:

- `memory_search` — find what your team already decided
- `memory_context` — pull the required conventions into the session
- `memory_propose` — draft a memory when it learns something
- `memory_feedback` — mark a memory as useful or not

Memories live in `.teambrain/` as markdown with YAML front-matter. Nothing
writes to `main`: proposals arrive as pull requests you review like code.

## Setup

1. **Install the CLI** — `npm install -g @teambrain/cli`
   (or keep it as a devDependency; a workspace `node_modules/.bin/tb` is
   preferred over the global one).
2. **Create a brain** — run `tb init` in your repo. It imports `CLAUDE.md`,
   `AGENTS.md`, `.cursor/rules/` and `docs/adr/` onto the branch
   `teambrain/init`. Review, merge.
3. **Check the status bar** — `✓ TeamBrain` means the server is registered.

Run **TeamBrain: Getting Started** from the command palette for the guided
version.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `teambrain.enabled` | `true` | Register the MCP server. Turn off to disable without uninstalling. |
| `teambrain.cliPath` | `""` | Absolute path to `tb`. Empty means: workspace `node_modules/.bin/tb`, then PATH. |

## Commands

- **TeamBrain: Show Status** — why the server is or is not registered
- **TeamBrain: Install the tb CLI** — opens a terminal with the install command (you press Enter)
- **TeamBrain: Write MCP Configuration** — writes `.vscode/mcp.json` by hand, for editors that cannot auto-register
- **TeamBrain: Getting Started** — the walkthrough

## Known limits — please read before filing a bug

- **Enterprise policy gating.** MCP in Copilot is governed by an org policy
  that is **disabled by default**. If no MCP servers ever appear, an
  administrator has to enable it; the extension cannot work around this.
- **Forks do not auto-register.** Cursor, Windsurf and VSCodium do not
  implement `vscode.lm.registerMcpServerDefinitionProvider`. The extension
  installs and runs there, detects the missing API, and offers to write
  `.vscode/mcp.json` instead — same server, one extra step.
- **VS Code capture is partial.** VS Code exposes no lifecycle hooks to an MCP
  server, so session boundaries are inferred from MCP calls: no edit or command
  telemetry, no commit attribution. The
  [capture matrix](https://github.com/donatienmigue/TeamBrain#compatibility)
  is the whole truth.
- **The extension needs the CLI.** It bundles no database and no embedding
  model on purpose — native modules compiled for Node do not load in the
  editor's Electron runtime.

## Privacy

The extension makes **no network requests** and ships **no telemetry** — a
release test fails the build if either appears in the bundle. Capture defaults
to metadata only: never raw prompts, file contents, or diff bodies. See
[SECURITY.md](https://github.com/donatienmigue/TeamBrain/blob/main/SECURITY.md).

Apache-2.0. Source: [donatienmigue/TeamBrain](https://github.com/donatienmigue/TeamBrain).
