import type { RegistrationMode } from './status.js';

// The cross-fork caveat, encoded. `vscode.lm.registerMcpServerDefinitionProvider`
// is consumed only by genuine VS Code + Copilot agent mode; Cursor exposes a
// proprietary `vscode.cursor.mcp.registerServer` instead, and Windsurf
// configures MCP only through its own config file. The VSIX ships to Open VSX
// and therefore installs in all of them, so the extension must ask the host
// what it supports rather than assume — a thrown TypeError on activation in
// Cursor would be a broken extension, not a degraded one.

/** The slice of `vscode.lm` this extension depends on. */
export interface LanguageModelApiShape {
  registerMcpServerDefinitionProvider?: unknown;
}

export function detectRegistrationMode(
  lm: LanguageModelApiShape | undefined,
): RegistrationMode {
  return typeof lm?.registerMcpServerDefinitionProvider === 'function'
    ? 'native'
    : 'manual';
}
