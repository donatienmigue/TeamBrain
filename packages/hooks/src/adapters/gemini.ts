import { join } from 'node:path';
import { z } from 'zod';
import type { SessionEvent } from '@teambrain/core';
import type { CaptureAdapter, InstallFile, MergeResult } from '../adapter.js';
import type { HookContext } from '../map.js';
import { mapPostToolUse, mapSessionEnd, mapSessionStart } from '../map.js';
import {
  sessionEndPayloadSchema,
  sessionStartPayloadSchema,
} from '../payloads.js';
import { asArray, asObject, ensureMcpServer } from './settings-merges.js';

// The Gemini CLI adapter: Tier A (native lifecycle hooks). The A1 spike
// (DEVLOG 2026-07-13, fixture testdata/sessions/raw-gemini-cli.jsonl) found
// Claude-compatible hooks in .gemini/settings.json (SessionStart, AfterTool,
// SessionEnd) with Claude-shaped stdin payloads, so the mappers are reused
// as-is. Hook commands carry `--tool gemini-cli` so events are labeled with
// the real vendor, not the claude-code default.

export interface GeminiHookSpec {
  event: string;
  command: string;
}

export const GEMINI_CAPTURE_HOOKS: GeminiHookSpec[] = [
  { event: 'SessionStart', command: 'tb hook session-start --tool gemini-cli' },
  { event: 'AfterTool', command: 'tb hook post-tool-use --tool gemini-cli' },
  { event: 'SessionEnd', command: 'tb hook session-end --tool gemini-cli' },
];

// Gemini's AfterTool payload is Claude-shaped (recorded fixture) except for
// the event name, so it gets its own schema; the mapper is reused unchanged.
const afterToolPayloadSchema = z.looseObject({
  hook_event_name: z.literal('AfterTool').optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  tool_name: z.string(),
  tool_input: z.looseObject({}).optional(),
  tool_response: z.looseObject({}).optional(),
});

function groupHasCommand(group: unknown, command: string): boolean {
  return asArray(asObject(group)['hooks']).some(
    (hook) => asObject(hook)['command'] === command,
  );
}

export function ensureGeminiCaptureHooks(
  existing: Record<string, unknown>,
): MergeResult {
  const rootHooks = asObject(existing['hooks'] ?? {});
  let changed = false;

  for (const spec of GEMINI_CAPTURE_HOOKS) {
    const groups = asArray(rootHooks[spec.event]);
    if (groups.some((group) => groupHasCommand(group, spec.command))) continue;
    const command: Record<string, unknown> = {
      type: 'command',
      command: spec.command,
    };
    rootHooks[spec.event] = [...groups, { hooks: [command] }];
    changed = true;
  }

  return changed
    ? { value: { ...existing, hooks: rootHooks }, changed: true }
    : { value: existing, changed: false };
}

export const geminiAdapter: CaptureAdapter = {
  tool: 'gemini-cli',
  displayName: 'Gemini CLI',
  tier: 'native-hooks',
  capabilities: {
    sessionStart: true,
    sessionEnd: true,
    toolUse: true,
    commitShas: true,
    planRevision: false,
  },

  mapEvent(raw: unknown, ctx: HookContext): SessionEvent | null {
    const name = asObject(raw)['hook_event_name'];
    switch (name) {
      case 'SessionStart':
        return mapSessionStart(sessionStartPayloadSchema.parse(raw), ctx);
      case 'AfterTool': {
        // Explicit allow-list: only the fields the mapper needs cross over —
        // anything else in the vendor payload is structurally dropped here.
        const p = afterToolPayloadSchema.parse(raw);
        return mapPostToolUse(
          {
            tool_name: p.tool_name,
            ...(p.session_id === undefined ? {} : { session_id: p.session_id }),
            ...(p.cwd === undefined ? {} : { cwd: p.cwd }),
            ...(p.tool_input === undefined ? {} : { tool_input: p.tool_input }),
            ...(p.tool_response === undefined
              ? {}
              : { tool_response: p.tool_response }),
          },
          ctx,
        );
      }
      case 'SessionEnd':
        return mapSessionEnd(sessionEndPayloadSchema.parse(raw), ctx);
      default:
        return null;
    }
  },

  installPlan(projectDir: string): InstallFile[] {
    // Both merges target the same file, so they must be one InstallFile —
    // two plans on one path would each be computed from the original content
    // and the second write would drop the first merge.
    return [
      {
        label: 'MCP server + capture hooks (.gemini/settings.json)',
        path: join(projectDir, '.gemini', 'settings.json'),
        format: 'json',
        merge: (existing) => {
          const mcp = ensureMcpServer(existing, 'gemini-cli');
          const hooks = ensureGeminiCaptureHooks(mcp.value);
          return {
            value: hooks.value,
            changed: mcp.changed || hooks.changed,
          };
        },
      },
    ];
  },

  describeDegradation(): string {
    return 'full native capture: session start/end, edits, commands, tests, exploration, commit SHAs';
  },
};
