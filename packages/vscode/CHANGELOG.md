# Changelog

## 0.1.0

First release.

- Registers the TeamBrain MCP server with Copilot agent mode via
  `vscode.lm.registerMcpServerDefinitionProvider` — no `.vscode/mcp.json`
  needed. One server per workspace folder that has a `.teambrain/` brain.
- Resolves the `tb` CLI from `teambrain.cliPath`, then a workspace
  `node_modules/.bin/tb`, then PATH; spawned as a child-process stdio server,
  so the VSIX carries no native modules.
- Status bar reporting the real blocker: missing CLI, missing brain, or a host
  without the registration API.
- Fallback for editors that do not implement the registration API (Cursor,
  Windsurf, VSCodium): **TeamBrain: Write MCP Configuration** writes the same
  server into `.vscode/mcp.json`, and refuses to overwrite a file it cannot
  parse.
- Getting-started walkthrough. No telemetry, no network calls.
