import { join } from 'node:path';
import type { SessionEvent } from '@teambrain/core';
import type {
  CaptureAdapter,
  InstallFile,
  MergeResult,
  TextMergeResult,
} from '../adapter.js';
import { asObject } from './settings-merges.js';

// The VS Code (Copilot) adapter: Tier B (MCP-side inference). VS Code's MCP
// support went GA in 1.102 and Copilot agent mode calls MCP tools like any
// other client, so serving needs nothing new — but VS Code exposes no
// lifecycle or post-tool hooks to a *server*, so capture rides the shared
// inference path (`tb mcp --client vscode`) exactly as Cursor and Codex do.
//
// Two things are VS Code-specific and are the whole reason this is not just
// `ensureMcpServer`:
//   1. the config root key is `servers`, not `mcpServers`, and each entry
//      declares its transport with `type: "stdio"`;
//   2. `${workspaceFolder}` is a documented variable in `.vscode/mcp.json`,
//      so the brain path resolves without baking an absolute path into a
//      file that gets committed.
// packages/vscode registers the same server programmatically (zero-config);
// this install plan is the fallback for users who don't want the extension,
// and for forks that don't implement the registration API.

/** VS Code's MCP config root key (`.vscode/mcp.json`), not Claude's `mcpServers`. */
export const VSCODE_MCP_SERVERS_KEY = 'servers';

/** Args `tb mcp` is launched with from a committed `.vscode/mcp.json`. */
export const VSCODE_MCP_ARGS = [
  'mcp',
  '${workspaceFolder}',
  '--client',
  'vscode',
] as const;

export function ensureVsCodeMcpServer(
  existing: Record<string, unknown>,
): MergeResult {
  const desired = {
    type: 'stdio',
    command: 'tb',
    args: [...VSCODE_MCP_ARGS],
  };
  const servers = asObject(existing[VSCODE_MCP_SERVERS_KEY]);
  if (JSON.stringify(servers['teambrain']) === JSON.stringify(desired)) {
    return { value: existing, changed: false };
  }
  return {
    value: {
      ...existing,
      [VSCODE_MCP_SERVERS_KEY]: { ...servers, teambrain: desired },
    },
    changed: true,
  };
}

// Copilot reads repo-wide custom instructions from `.github/instructions/
// *.instructions.md`. TeamBrain owns exactly one such file so a rewrite can
// never clobber the user's own instructions — the same ownership rule the
// Cursor adapter follows with `.cursor/rules/teambrain.mdc`.
export function ensureVsCodeInstructions(existingRaw: string): TextMergeResult {
  const desired = `---
applyTo: '**'
---
# TeamBrain Memory Rules
Always call \`mcp__teambrain__memory_context\` at the start of your work.
Always call \`mcp__teambrain__memory_propose\` at the end of your work if you learned something new.
`;
  if (existingRaw === desired) return { value: existingRaw, changed: false };
  return { value: desired, changed: true };
}

export const vscodeAdapter: CaptureAdapter = {
  tool: 'vscode',
  displayName: 'VS Code (Copilot)',
  tier: 'mcp-inference',
  capabilities: {
    sessionStart: true,
    sessionEnd: true,
    toolUse: false,
    commitShas: false,
    planRevision: false,
  },

  // Tier B: no hook payloads exist, so there is never an event to map here.
  mapEvent(): SessionEvent | null {
    return null;
  },

  installPlan(projectDir: string): InstallFile[] {
    return [
      {
        label: 'MCP server (.vscode/mcp.json)',
        path: join(projectDir, '.vscode', 'mcp.json'),
        format: 'json',
        merge: ensureVsCodeMcpServer,
      },
      {
        label:
          'Copilot instructions (.github/instructions/teambrain.instructions.md)',
        path: join(
          projectDir,
          '.github',
          'instructions',
          'teambrain.instructions.md',
        ),
        format: 'text',
        merge: ensureVsCodeInstructions,
      },
    ];
  },

  describeDegradation(): string {
    return 'VS Code exposes no hooks to an MCP server; sessions inferred from MCP calls, edit/command telemetry unavailable';
  },
};
