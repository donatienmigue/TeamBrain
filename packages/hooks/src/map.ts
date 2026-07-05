import type { SessionEvent } from '@teambrain/core';
import type { DenyMatcher, RedactionLevel } from '@teambrain/redact';
import type {
  PostToolUsePayload,
  SessionEndPayload,
  SessionStartPayload,
} from './payloads.js';

// M5.2 pure mappers: raw Claude Code payload → C2 event. The privacy contract
// lives here — a tool_use event carries only {kind, path?, exit_code?}. We may
// *read* content fields (a Bash command) to classify, but never *store* them.

export interface HookContext {
  sid: string;
  repo: string;
  branch: string;
  /** Agent tool id; 'claude-code' here. */
  tool: string;
  model: string;
  redactionLevel: RedactionLevel;
  now: () => Date;
  /** Deny matcher (.gitignore + brain.yaml deny-globs); drops matching paths. */
  deny?: DenyMatcher;
  /** Session bookkeeping for session_end. */
  session?: { startedAt?: Date; turns?: number; commitShas?: string[] };
}

const EDIT_TOOLS = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Update',
]);

const TEST_COMMAND =
  /\b(vitest|jest|mocha|pytest|rspec|phpunit|go\s+test|cargo\s+test|gradle\s+test|dotnet\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test)\b/;

function envelope(
  ctx: HookContext,
  sid: string,
  ev: SessionEvent['ev'],
  data: Record<string, unknown>,
): SessionEvent {
  return {
    v: 1,
    sid,
    t: ctx.now().toISOString(),
    tool: ctx.tool,
    model: ctx.model,
    repo: ctx.repo,
    branch: ctx.branch,
    ev,
    data,
  } as SessionEvent;
}

function sidOf(payloadSid: string | undefined, ctx: HookContext): string {
  return payloadSid !== undefined && payloadSid.length > 0
    ? payloadSid
    : ctx.sid;
}

function numericExitCode(
  response: Record<string, unknown> | undefined,
): number | undefined {
  if (response === undefined) return undefined;
  for (const key of ['exit_code', 'exitCode', 'code', 'returnCode']) {
    const value = response[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

/**
 * Maps a PostToolUse payload to a C2 `tool_use` event, or null when the tool
 * is not a captured kind (Read/Grep/…) or the touched path is deny-listed.
 * Only path + exit_code ever reach the event.
 */
export function mapPostToolUse(
  payload: PostToolUsePayload,
  ctx: HookContext,
): SessionEvent | null {
  const input = (payload.tool_input ?? {}) as Record<string, unknown>;
  let kind: 'edit' | 'command' | 'test';
  let path: string | undefined;

  if (EDIT_TOOLS.has(payload.tool_name)) {
    kind = 'edit';
    const candidate = input['file_path'] ?? input['notebook_path'];
    path = typeof candidate === 'string' ? candidate : undefined;
  } else if (payload.tool_name === 'Bash') {
    const command =
      typeof input['command'] === 'string' ? input['command'] : '';
    kind = TEST_COMMAND.test(command) ? 'test' : 'command';
  } else {
    return null; // Read/Grep/Glob/WebFetch/… are not tool_use events
  }

  if (path !== undefined && ctx.deny?.denies(path) === true) return null;

  const data: Record<string, unknown> = { kind };
  if (path !== undefined) data['path'] = path;
  const exitCode = numericExitCode(
    payload.tool_response as Record<string, unknown>,
  );
  if (exitCode !== undefined) data['exit_code'] = exitCode;

  return envelope(ctx, sidOf(payload.session_id, ctx), 'tool_use', data);
}

/** Maps a SessionStart payload to a C2 `session_start` event. */
export function mapSessionStart(
  payload: SessionStartPayload,
  ctx: HookContext,
): SessionEvent {
  return envelope(ctx, sidOf(payload.session_id, ctx), 'session_start', {});
}

/**
 * Maps a Stop/SessionEnd payload to a C2 `session_end` event. Outcome is the
 * commit heuristic: committed if any commit landed during the session, else
 * abandoned when there were turns, else unknown.
 */
export function mapSessionEnd(
  payload: SessionEndPayload,
  ctx: HookContext,
): SessionEvent {
  const session = ctx.session ?? {};
  const turns = session.turns ?? 0;
  const commitShas = session.commitShas ?? [];
  const durationS =
    session.startedAt !== undefined
      ? Math.max(0, (ctx.now().getTime() - session.startedAt.getTime()) / 1000)
      : 0;
  const outcome =
    commitShas.length > 0 ? 'committed' : turns > 0 ? 'abandoned' : 'unknown';
  return envelope(ctx, sidOf(payload.session_id, ctx), 'session_end', {
    outcome,
    duration_s: durationS,
    turns,
    commit_shas: commitShas,
  });
}
