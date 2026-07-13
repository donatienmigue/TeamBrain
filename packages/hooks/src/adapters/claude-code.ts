import { join } from 'node:path';
import type { SessionEvent } from '@teambrain/core';
import type { CaptureAdapter, InstallFile, MergeResult } from '../adapter.js';
import type { HookContext } from '../map.js';
import { mapPostToolUse, mapSessionEnd, mapSessionStart } from '../map.js';
import {
  postToolUsePayloadSchema,
  sessionEndPayloadSchema,
  sessionStartPayloadSchema,
} from '../payloads.js';
import { asArray, asObject, ensureMcpServer } from './settings-merges.js';

// The Claude Code adapter: Tier A (native lifecycle hooks). The mappers in
// map.ts are the originals — this adapter only routes a raw hook payload to
// the right one by its hook_event_name, so behavior is identical to the
// pre-framework processHookPayload path.

/** The command the SessionStart hook runs. `tb` is expected on PATH. */
export const SESSION_START_HOOK_COMMAND = 'tb hook session-start';

export interface HookSpec {
  event: string;
  command: string;
  /** PostToolUse/Stop fire-and-forget; SessionStart injects context, so sync. */
  async: boolean;
}

/** The Claude Code hooks `tb install` registers (M4.3 + M5.2). */
export const CAPTURE_HOOKS: HookSpec[] = [
  { event: 'SessionStart', command: SESSION_START_HOOK_COMMAND, async: false },
  { event: 'PostToolUse', command: 'tb hook post-tool-use', async: true },
  { event: 'Stop', command: 'tb hook stop', async: true },
];

function groupHasCommand(group: unknown, command: string): boolean {
  return asArray(asObject(group)['hooks']).some(
    (hook) => asObject(hook)['command'] === command,
  );
}

/**
 * Ensures `.claude/settings.json` registers every TeamBrain capture hook
 * (SessionStart, PostToolUse, Stop). Idempotent: an event whose group already
 * runs the command is left untouched, so no duplicates accumulate and a second
 * install is a no-op.
 */
export function ensureCaptureHooks(
  existing: Record<string, unknown>,
): MergeResult {
  const hooks = asObject(existing['hooks']);
  let changed = false;
  for (const spec of CAPTURE_HOOKS) {
    const groups = asArray(hooks[spec.event]);
    if (groups.some((group) => groupHasCommand(group, spec.command))) continue;
    const command: Record<string, unknown> = {
      type: 'command',
      command: spec.command,
    };
    if (spec.async) command['async'] = true;
    hooks[spec.event] = [...groups, { hooks: [command] }];
    changed = true;
  }
  return changed
    ? { value: { ...existing, hooks }, changed: true }
    : { value: existing, changed: false };
}

export const claudeCodeAdapter: CaptureAdapter = {
  tool: 'claude-code',
  displayName: 'Claude Code',
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
      case 'PostToolUse':
        return mapPostToolUse(postToolUsePayloadSchema.parse(raw), ctx);
      case 'Stop':
      case 'SessionEnd':
        return mapSessionEnd(sessionEndPayloadSchema.parse(raw), ctx);
      default:
        return null;
    }
  },

  installPlan(projectDir: string): InstallFile[] {
    return [
      {
        label: 'MCP server (.mcp.json)',
        path: join(projectDir, '.mcp.json'),
        format: 'json',
        merge: (existing) => ensureMcpServer(existing, 'claude-code'),
      },
      {
        label: 'Capture hooks (.claude/settings.json)',
        path: join(projectDir, '.claude', 'settings.json'),
        format: 'json',
        merge: ensureCaptureHooks,
      },
    ];
  },

  describeDegradation(): string {
    return 'full native capture: session start/end, edits, commands, tests, exploration, commit SHAs';
  },
};
