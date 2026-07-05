import { describe, expect, it } from 'vitest';
import { buildDenyMatcher } from '@teambrain/redact';
import {
  mapPostToolUse,
  mapSessionEnd,
  mapSessionStart,
  type HookContext,
} from './map.js';

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    sid: 'sid-1',
    repo: 'acme/api',
    branch: 'main',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    redactionLevel: 'strict',
    now: () => new Date('2026-07-05T12:00:00.000Z'),
    ...overrides,
  };
}

describe('mapPostToolUse', () => {
  it('maps an edit to {kind, path}, dropping content fields', () => {
    const event = mapPostToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' },
      },
      ctx(),
    );
    expect(event?.ev).toBe('tool_use');
    expect(event?.data).toEqual({ kind: 'edit', path: 'src/a.ts' });
  });

  it('classifies a test command and captures the exit code', () => {
    const event = mapPostToolUse(
      {
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        tool_response: { exit_code: 1 },
      },
      ctx(),
    );
    expect(event?.data).toEqual({ kind: 'test', exit_code: 1 });
  });

  it('classifies a non-test command without a path', () => {
    const event = mapPostToolUse(
      { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      ctx(),
    );
    expect(event?.data).toEqual({ kind: 'command' });
  });

  it('returns null for non-captured tools', () => {
    expect(
      mapPostToolUse({ tool_name: 'Read', tool_input: { file_path: 'x' } }, ctx()),
    ).toBeNull();
  });

  it('drops an event whose path is deny-listed', () => {
    const event = mapPostToolUse(
      { tool_name: 'Write', tool_input: { file_path: 'config/prod.env' } },
      ctx({ deny: buildDenyMatcher(['*.env']) }),
    );
    expect(event).toBeNull();
  });

  it('prefers the payload session_id over the context sid', () => {
    const event = mapPostToolUse(
      { session_id: 'payload-sid', tool_name: 'Bash', tool_input: { command: 'ls' } },
      ctx(),
    );
    expect(event?.sid).toBe('payload-sid');
  });
});

describe('mapSessionEnd outcome heuristic', () => {
  it('committed when commits were made', () => {
    const event = mapSessionEnd({}, ctx({ session: { commitShas: ['abc'] } }));
    expect((event.data as { outcome: string }).outcome).toBe('committed');
  });
  it('abandoned when there were turns but no commits', () => {
    const event = mapSessionEnd({}, ctx({ session: { turns: 4, commitShas: [] } }));
    expect((event.data as { outcome: string }).outcome).toBe('abandoned');
  });
  it('unknown when nothing is known', () => {
    const event = mapSessionEnd({}, ctx());
    expect((event.data as { outcome: string }).outcome).toBe('unknown');
  });
});

describe('mapSessionStart', () => {
  it('emits an empty-data session_start', () => {
    const event = mapSessionStart({ session_id: 's' }, ctx());
    expect(event.ev).toBe('session_start');
    expect(event.data).toEqual({});
  });
});
