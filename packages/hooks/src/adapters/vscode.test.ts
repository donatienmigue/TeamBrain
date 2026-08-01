import { describe, expect, it } from 'vitest';
import {
  ensureVsCodeInstructions,
  ensureVsCodeMcpServer,
  vscodeAdapter,
} from './vscode.js';

// The VS Code adapter is Tier B: it declares no hook capture, so the tests
// that matter are the config merges (idempotency + not clobbering the user's
// own servers) and the negative capability assertions that keep the README
// matrix honest.

describe('vscode adapter — .vscode/mcp.json merge', () => {
  it('registers the server under VS Code’s `servers` root key', () => {
    const { value, changed } = ensureVsCodeMcpServer({});
    expect(changed).toBe(true);
    expect(value).toEqual({
      servers: {
        teambrain: {
          type: 'stdio',
          command: 'tb',
          args: ['mcp', '${workspaceFolder}', '--client', 'vscode'],
        },
      },
    });
    // Claude Code's key must not appear — VS Code would ignore the file.
    expect(value['mcpServers']).toBeUndefined();
  });

  it('is idempotent: a second merge reports no change', () => {
    const first = ensureVsCodeMcpServer({});
    const second = ensureVsCodeMcpServer(first.value);
    expect(second.changed).toBe(false);
    expect(second.value).toEqual(first.value);
  });

  it('preserves other servers and unrelated top-level keys', () => {
    const existing = {
      inputs: [{ id: 'token', type: 'promptString' }],
      servers: { other: { type: 'stdio', command: 'other-mcp' } },
    };
    const { value, changed } = ensureVsCodeMcpServer(existing);
    expect(changed).toBe(true);
    const servers = value['servers'] as Record<string, unknown>;
    expect(servers['other']).toEqual({ type: 'stdio', command: 'other-mcp' });
    expect(value['inputs']).toEqual(existing.inputs);
  });

  it('repairs a stale teambrain entry rather than leaving it', () => {
    const stale = { servers: { teambrain: { command: 'tb', args: ['mcp'] } } };
    const { value, changed } = ensureVsCodeMcpServer(stale);
    expect(changed).toBe(true);
    const servers = value['servers'] as Record<string, unknown>;
    expect(servers['teambrain']).toMatchObject({ type: 'stdio' });
  });
});

describe('vscode adapter — Copilot instructions file', () => {
  it('writes an applyTo front-matter block asking for context + propose', () => {
    const { value, changed } = ensureVsCodeInstructions('');
    expect(changed).toBe(true);
    expect(value).toContain("applyTo: '**'");
    expect(value).toContain('mcp__teambrain__memory_context');
    expect(value).toContain('mcp__teambrain__memory_propose');
  });

  it('is idempotent', () => {
    const first = ensureVsCodeInstructions('');
    expect(ensureVsCodeInstructions(first.value).changed).toBe(false);
  });
});

describe('vscode adapter — declared capabilities (anti-overclaim)', () => {
  it('claims session boundaries only, never tool telemetry or commits', () => {
    expect(vscodeAdapter.tier).toBe('mcp-inference');
    expect(vscodeAdapter.capabilities).toEqual({
      sessionStart: true,
      sessionEnd: true,
      toolUse: false,
      commitShas: false,
      planRevision: false,
    });
    expect(vscodeAdapter.describeDegradation()).toContain('inferred');
  });

  it('maps no hook payloads — there are none to map', () => {
    expect(vscodeAdapter.mapEvent()).toBeNull();
  });

  it('owns its instructions file so a rewrite cannot clobber the user’s', () => {
    const paths = vscodeAdapter.installPlan('/repo').map((f) => f.path);
    expect(paths.some((p) => p.endsWith('teambrain.instructions.md'))).toBe(
      true,
    );
    // Never the shared repo-wide file.
    expect(paths.some((p) => p.endsWith('copilot-instructions.md'))).toBe(
      false,
    );
  });
});
