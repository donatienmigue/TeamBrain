import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sessionEventSchema, type SessionEvent } from '@teambrain/core';
import { buildDenyMatcher } from '@teambrain/redact';
import type { HookContext } from '../map.js';
import { redactEvent } from '../redact-event.js';
import { geminiAdapter } from './gemini.js';

// A4 per-adapter test set (ADAPTERS_PLAN §D) against the recorded fixture
// testdata/sessions/raw-gemini-cli.jsonl: mapping units, privacy negative,
// C2 validity, install idempotence, latency.

const here = dirname(fileURLToPath(import.meta.url));

function fixtureLines(): string[] {
  return readFileSync(
    join(
      here,
      '..',
      '..',
      '..',
      '..',
      'testdata',
      'sessions',
      'raw-gemini-cli.jsonl',
    ),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

function testContext(): HookContext {
  return {
    sid: 'ctx-sid',
    repo: 'acme/api',
    branch: 'main',
    tool: 'gemini-cli',
    model: 'unknown',
    redactionLevel: 'strict',
    now: () => new Date('2026-07-13T18:30:13.000Z'),
    deny: buildDenyMatcher(['*.env']),
    session: {
      startedAt: new Date('2026-07-13T18:27:13.000Z'),
      turns: 2,
      commitShas: [],
    },
  };
}

// Content strings present in the raw fixture that must never reach an event.
const RAW_CONTENT = ['new content', 'pnpm test'];
const FORBIDDEN_KEYS = [
  'content',
  'old_string',
  'new_string',
  'prompt',
  'command',
];

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      collectKeys(entry, keys);
    }
  }
}

describe('gemini-cli adapter (A4 accept)', () => {
  const ctx = testContext();
  const events: SessionEvent[] = [];
  for (const line of fixtureLines()) {
    const mapped = geminiAdapter.mapEvent(JSON.parse(line), ctx);
    if (mapped !== null) {
      events.push(
        redactEvent(mapped, ctx.redactionLevel).event as SessionEvent,
      );
    }
  }

  it('maps the recorded session to C2-valid events with real join keys', () => {
    expect(events.map((e) => e.ev)).toEqual([
      'session_start',
      'tool_use',
      'tool_use',
      'session_end',
    ]);
    for (const event of events) {
      expect(() => sessionEventSchema.parse(event)).not.toThrow();
      expect(event.tool).toBe('gemini-cli');
      for (const key of ['sid', 'repo', 'branch', 'model'] as const) {
        expect(String(event[key]).length).toBeGreaterThan(0);
      }
    }
  });

  it('classifies AfterTool payloads and keeps only path + exit_code', () => {
    const toolUses = events.filter((e) => e.ev === 'tool_use');
    expect(toolUses.map((e) => (e.data as { kind: string }).kind)).toEqual([
      'edit',
      'test',
    ]);
    for (const event of toolUses) {
      for (const key of Object.keys(event.data)) {
        expect(['kind', 'path', 'exit_code']).toContain(key);
      }
    }
  });

  it('privacy negative: structurally drops all content (D2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event.data, keys);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    const serialized = JSON.stringify(events);
    for (const raw of RAW_CONTENT) {
      expect(serialized).not.toContain(raw);
    }
  });

  it('drops deny-listed paths like every other adapter', () => {
    const denied = geminiAdapter.mapEvent(
      {
        hook_event_name: 'AfterTool',
        tool_name: 'Edit',
        tool_input: { file_path: 'secrets.env', content: 'x' },
      },
      ctx,
    );
    expect(denied).toBeNull();
  });

  it('install plan is one composed file: MCP server + hooks land together', () => {
    const plan = geminiAdapter.installPlan(join('proj'));
    expect(plan).toHaveLength(1);
    const file = plan[0];
    if (file === undefined || file.format !== 'json') {
      throw new Error('expected a single json plan');
    }
    const once = file.merge({});
    expect(once.changed).toBe(true);
    const value = once.value as {
      mcpServers?: Record<string, unknown>;
      hooks?: Record<string, unknown>;
    };
    // The A2-review bug: two plans on one path dropped the first merge.
    expect(value.mcpServers?.['teambrain']).toBeDefined();
    expect(Object.keys(value.hooks ?? {})).toEqual([
      'SessionStart',
      'AfterTool',
      'SessionEnd',
    ]);
    // Converges in ONE run: re-merging the merged value is a no-op.
    expect(file.merge(once.value).changed).toBe(false);
    // Hook commands carry the vendor label.
    expect(JSON.stringify(value.hooks)).toContain('--tool gemini-cli');
  });

  it('handles each payload well under the 20ms budget (p95, D5)', () => {
    const lines = fixtureLines();
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      for (const line of lines) {
        const start = performance.now();
        geminiAdapter.mapEvent(JSON.parse(line), ctx);
        samples.push(performance.now() - start);
      }
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(20);
  });
});
