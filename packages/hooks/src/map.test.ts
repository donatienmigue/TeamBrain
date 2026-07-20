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

  it('maps Read to an explore event with its path (C2 explore, approved)', () => {
    const event = mapPostToolUse(
      { tool_name: 'Read', tool_input: { file_path: 'src/store.ts' } },
      ctx(),
    );
    expect(event?.data).toEqual({ kind: 'explore', path: 'src/store.ts' });
  });

  it('maps Grep to explore, never capturing the pattern', () => {
    const event = mapPostToolUse(
      {
        tool_name: 'Grep',
        tool_input: { pattern: 'SECRET_[A-Z]+', path: 'packages' },
      },
      ctx(),
    );
    expect(event?.data).toEqual({ kind: 'explore', path: 'packages' });
    expect(JSON.stringify(event)).not.toContain('SECRET_');
  });

  it('negative: a deny-listed explore path is dropped', () => {
    const event = mapPostToolUse(
      { tool_name: 'Read', tool_input: { file_path: 'config/prod.env' } },
      ctx({ deny: buildDenyMatcher(['*.env']) }),
    );
    expect(event).toBeNull();
  });

  it('returns null for non-captured tools', () => {
    expect(
      mapPostToolUse(
        { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } },
        ctx(),
      ),
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
      {
        session_id: 'payload-sid',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
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
    const event = mapSessionEnd(
      {},
      ctx({ session: { turns: 4, commitShas: [] } }),
    );
    expect((event.data as { outcome: string }).outcome).toBe('abandoned');
  });
  it('unknown when nothing is known', () => {
    const event = mapSessionEnd({}, ctx());
    expect((event.data as { outcome: string }).outcome).toBe('unknown');
  });
});

describe('mapSessionStart', () => {
  it('tags codemap_arm (treatment when no holdout) and nothing else', () => {
    const event = mapSessionStart({ session_id: 's' }, ctx());
    expect(event.ev).toBe('session_start');
    expect(event.data).toEqual({ codemap_arm: 'treatment' });
  });

  it('assigns the arm deterministically from the session sid + holdout', () => {
    // Same sid + holdout → same arm on every call; the value matches the pure
    // core function so the serving bypass and digest agree.
    const first = mapSessionStart(
      { session_id: 'sid-1' },
      ctx({ codemapHoldout: 0.5 }),
    ).data['codemap_arm'];
    const again = mapSessionStart(
      { session_id: 'sid-1' },
      ctx({ codemapHoldout: 0.5 }),
    ).data['codemap_arm'];
    expect(again).toBe(first);
    expect(['control', 'treatment']).toContain(first);
    // holdout 1 → always control, regardless of sid.
    expect(
      mapSessionStart({ session_id: 'anything' }, ctx({ codemapHoldout: 1 }))
        .data['codemap_arm'],
    ).toBe('control');
  });

  it('codemap_arm appears on session_start only, never on tool_use/session_end', () => {
    const tool = mapPostToolUse({ tool_name: 'Read', tool_input: {} }, ctx());
    expect(tool?.data).not.toHaveProperty('codemap_arm');
    const end = mapSessionEnd({ session_id: 's' }, ctx());
    expect(end.data).not.toHaveProperty('codemap_arm');
  });
});
