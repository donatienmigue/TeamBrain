import { join } from 'node:path';
import type { SessionEvent } from '@teambrain/core';
import type {
  CaptureAdapter,
  InstallFile,
  TextMergeResult,
} from '../adapter.js';
import { ensureMcpServer } from './settings-merges.js';

// The Cursor adapter: Tier B (MCP-side inference). Cursor exposes no
// lifecycle or post-tool hooks, so there are no vendor payloads to map —
// capture happens inside `tb mcp --client cursor` via the CursorInterceptor
// (session_start on first MCP call; session_end on memory_propose or 30-min
// idle). No tool_use events; degradation is honest and reported by doctor.

export function ensureCursorRules(existingRaw: string): TextMergeResult {
  const desired = `---
description: TeamBrain memory capture
globs: *
---
# TeamBrain Memory Rules
Always call \`mcp__teambrain__memory_context\` at the start of your work.
Always call \`mcp__teambrain__memory_propose\` at the end of your work if you learned something new.
`;
  if (existingRaw === desired) return { value: existingRaw, changed: false };
  return { value: desired, changed: true };
}

export const cursorAdapter: CaptureAdapter = {
  tool: 'cursor',
  displayName: 'Cursor',
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
        label: 'MCP server (.cursor/mcp.json)',
        path: join(projectDir, '.cursor', 'mcp.json'),
        format: 'json',
        merge: (existing) => ensureMcpServer(existing, 'cursor'),
      },
      {
        label: 'Cursor rules (.cursor/rules/teambrain.mdc)',
        path: join(projectDir, '.cursor', 'rules', 'teambrain.mdc'),
        format: 'text',
        merge: ensureCursorRules,
      },
    ];
  },

  describeDegradation(): string {
    return 'Cursor lacks native hooks; edit/command telemetry unavailable';
  },
};
