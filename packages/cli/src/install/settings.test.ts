import { describe, expect, it } from 'vitest';
import {
  CAPTURE_HOOKS,
  ensureCaptureHooks,
  ensureMcpServer,
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

describe('ensureCaptureHooks', () => {
  it('adds SessionStart (sync) plus async PostToolUse and Stop', () => {
    const { value, changed } = ensureCaptureHooks({});
    expect(changed).toBe(true);
    const hooks = value['hooks'] as Record<string, unknown[]>;
    expect(hooks['SessionStart']).toEqual([
      { hooks: [{ type: 'command', command: SESSION_START_HOOK_COMMAND }] },
    ]);
    expect(hooks['PostToolUse']).toEqual([
      {
        hooks: [
          { type: 'command', command: 'tb hook post-tool-use', async: true },
        ],
      },
    ]);
    expect(hooks['Stop']).toEqual([
      { hooks: [{ type: 'command', command: 'tb hook stop', async: true }] },
    ]);
  });

  it('registers exactly the CAPTURE_HOOKS event set', () => {
    const hooks = ensureCaptureHooks({}).value['hooks'] as Record<
      string,
      unknown
    >;
    expect(Object.keys(hooks).sort()).toEqual(
      CAPTURE_HOOKS.map((h) => h.event).sort(),
    );
  });

  it('does not duplicate hooks on a second pass', () => {
    const once = ensureCaptureHooks({}).value;
    const { changed } = ensureCaptureHooks(once);
    expect(changed).toBe(false);
  });

  it('keeps existing SessionStart groups from other tools', () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool' }] }],
      },
    };
    const { value, changed } = ensureCaptureHooks(existing);
    expect(changed).toBe(true);
    const groups = (value['hooks'] as { SessionStart: unknown[] }).SessionStart;
    expect(groups).toHaveLength(2);
  });
});
