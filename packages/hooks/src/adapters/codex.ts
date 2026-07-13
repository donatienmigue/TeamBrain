import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '@teambrain/core';
import type {
  CaptureAdapter,
  InstallFile,
  TextMergeResult,
} from '../adapter.js';

// The Codex adapter: Tier B (MCP-side inference). The A1 spike (DEVLOG
// 2026-07-13, fixture testdata/sessions/raw-codex.jsonl) found only a
// `notify` hook firing on agent-turn-complete — no tool telemetry and no
// session lifecycle — so capture rides the MCP-side inference path:
// `tb mcp --client codex` wraps the server exactly like Cursor's.

export function ensureCodexMcpServer(existingRaw: string): TextMergeResult {
  const desiredConfig = `
[mcp_servers.teambrain]
command = "tb"
args = ["mcp", "--client", "codex"]
`;

  // If the section exists we assume it is configured; a substring check is
  // enough for the idempotency promise without pulling in a TOML parser.
  if (existingRaw.includes('[mcp_servers.teambrain]')) {
    return { value: existingRaw, changed: false };
  }

  const value = existingRaw.trimEnd() + '\n' + desiredConfig;
  return { value, changed: true };
}

export const codexAdapter: CaptureAdapter = {
  tool: 'codex',
  displayName: 'Codex',
  tier: 'mcp-inference',
  capabilities: {
    sessionStart: true,
    sessionEnd: true,
    toolUse: false,
    commitShas: false,
    planRevision: false,
  },

  // Tier B: no usable hook payloads, so there is never an event to map here.
  mapEvent(): SessionEvent | null {
    return null;
  },

  installPlan(): InstallFile[] {
    // Codex reads MCP servers from its global config. CODEX_HOME is Codex's
    // own override for that directory — honoring it also keeps install tests
    // out of the user's real home (CLAUDE.md testing rules).
    const codexHome = process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
    return [
      {
        label: 'MCP server (~/.codex/config.toml)',
        path: join(codexHome, 'config.toml'),
        format: 'text',
        merge: ensureCodexMcpServer,
      },
    ];
  },

  describeDegradation(): string {
    return 'Codex lacks tool-telemetry hooks; sessions inferred from MCP calls, edit/command telemetry unavailable';
  },
};
