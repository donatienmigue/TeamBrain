## Confirm it is wired up

The status bar shows one of:

- **✓ TeamBrain** — the MCP server is registered and serving your brain. Ask
  agent mode something your team has decided before and it will call
  `memory_search`.
- **⚠ TeamBrain** — hover for the reason: no CLI on PATH, no `.teambrain/` in
  this workspace, or an editor that cannot auto-register MCP servers.

Two things that are not bugs:

- **Enterprise policy.** MCP in Copilot is governed by an org policy that is
  disabled by default. If servers never appear, an admin has to enable it.
- **Forks.** Cursor, Windsurf and VSCodium do not implement VS Code's MCP
  registration API. There the extension offers to write `.vscode/mcp.json`
  instead — run **TeamBrain: Write MCP Configuration**.
