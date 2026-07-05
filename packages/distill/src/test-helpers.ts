import type { SessionEvent } from '@teambrain/core';
import type { SessionRecord } from './types.js';

// Shared test utilities (not exported from the package).

export function event(
  sid: string,
  ev: SessionEvent['ev'],
  data: Record<string, unknown>,
): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-05T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev,
    data,
  } as SessionEvent;
}

export function edit(sid: string, path: string): SessionEvent {
  return event(sid, 'tool_use', { kind: 'edit', path });
}

export function command(
  sid: string,
  exitCode: number,
  kind: 'command' | 'test' = 'command',
): SessionEvent {
  return event(sid, 'tool_use', { kind, exit_code: exitCode });
}

export function noHit(sid: string): SessionEvent {
  return event(sid, 'memory_retrieved', { ids: [] });
}

export function proposed(sid: string, title: string): SessionEvent {
  return event(sid, 'candidate_proposed', {
    draft: { class: 'learning', title, body: `Body for ${title}.` },
  });
}

export function record(
  sid: string,
  events: SessionEvent[],
  commitShas: string[] = [],
): SessionRecord {
  return { sid, events, commitShas };
}
