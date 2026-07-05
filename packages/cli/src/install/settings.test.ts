import { describe, expect, it } from 'vitest';
import {
  ensureMcpServer,
  ensureSessionStartHook,
  SESSION_START_HOOK_COMMAND,
} from './settings.js';

describe('ensureMcpServer', () => {
  it('registers the teambrain server on an empty config', () => {
    const { value, changed } = ensureMcpServer({});
    expect(changed).toBe(true);
    expect(value).toEqual({
      mcpServers: { teambrain: { command: 'tb', args: ['mcp'] } },
    });
  });

  it('is a no-op when already registered', () => {
    const once = ensureMcpServer({}).value;
    const { changed } = ensureMcpServer(once);
    expect(changed).toBe(false);
  });

  it('preserves other servers and unrelated keys', () => {
    const { value } = ensureMcpServer({
      mcpServers: { other: { command: 'x' } },
      unrelated: 42,
    });
    expect(value['unrelated']).toBe(42);
    expect((value['mcpServers'] as Record<string, unknown>)['other']).toEqual({
      command: 'x',
    });
  });
});

describe('ensureSessionStartHook', () => {
  it('adds a SessionStart group running the injector', () => {
    const { value, changed } = ensureSessionStartHook({});
    expect(changed).toBe(true);
    const groups = (value['hooks'] as { SessionStart: unknown[] }).SessionStart;
    expect(groups).toEqual([
      { hooks: [{ type: 'command', command: SESSION_START_HOOK_COMMAND }] },
    ]);
  });

  it('does not duplicate the hook on a second pass', () => {
    const once = ensureSessionStartHook({}).value;
    const { changed } = ensureSessionStartHook(once);
    expect(changed).toBe(false);
  });

  it('keeps existing SessionStart groups from other tools', () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool' }] }],
      },
    };
    const { value, changed } = ensureSessionStartHook(existing);
    expect(changed).toBe(true);
    const groups = (value['hooks'] as { SessionStart: unknown[] }).SessionStart;
    expect(groups).toHaveLength(2);
  });
});
