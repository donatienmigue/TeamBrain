import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionEventSchema, type SessionEvent } from '@teambrain/core';
import { buildDenyMatcher } from '@teambrain/redact';
import { processHookPayload, type CaptureHookName } from './run.js';
import type { HookContext } from './map.js';

// M5.2 accept: replay the recorded fixture session through the hook handlers
// and assert the produced JSONL is C2-valid, fully redacted, content-free, and
// fast (<20ms p95).

function fixturePayloads(): Array<{ hook: CaptureHookName; json: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', '..', 'testdata', 'sessions', 'raw-claude.jsonl');
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as { hook_event_name: CaptureHookName };
      return { hook: parsed.hook_event_name, json: line };
    });
}

function testContext(): HookContext {
  return {
    sid: 'ctx-sid',
    repo: 'acme/api',
    branch: 'feat/webhooks',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    redactionLevel: 'strict',
    now: () => new Date('2026-07-05T12:00:00.000Z'),
    deny: buildDenyMatcher(['*.env']),
    session: {
      startedAt: new Date('2026-07-05T11:30:00.000Z'),
      turns: 3,
      commitShas: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
    },
  };
}

// Secrets present in the raw fixture that must never survive into an event.
const RAW_SECRETS = [
  'AKIAIOSFODNN7EXAMPLE',
  'ghp_abcdef0123456789abcdef0123456789abcd',
  'hunter2SuperSecretValue',
  'leak@example.com',
];
const FORBIDDEN_KEYS = ['content', 'old_string', 'new_string', 'command'];

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

describe('hook replay (M5.2 accept)', () => {
  const payloads = fixturePayloads();
  const ctx = testContext();
  const events: SessionEvent[] = [];
  for (const { hook, json } of payloads) {
    const { event } = processHookPayload(hook, json, ctx);
    if (event !== null) events.push(event);
  }

  it('produces C2-valid events (Read + deny-listed path dropped)', () => {
    // 10 payloads: Read and the *.env edit drop → 8 events.
    expect(events).toHaveLength(8);
    for (const event of events) {
      expect(() => sessionEventSchema.parse(event)).not.toThrow();
    }
    expect(events.map((e) => e.ev)).toEqual([
      'session_start',
      'tool_use',
      'tool_use',
      'tool_use',
      'tool_use',
      'tool_use',
      'tool_use',
      'session_end',
    ]);
  });

  it('classifies tool kinds and keeps only path + exit_code', () => {
    const toolUses = events.filter((e) => e.ev === 'tool_use');
    for (const event of toolUses) {
      expect(Object.keys(event.data).sort()).toEqual(
        Object.keys(event.data)
          .filter((k) => ['kind', 'path', 'exit_code'].includes(k))
          .sort(),
      );
    }
    const kinds = toolUses.map((e) => (e.data as { kind: string }).kind);
    expect(kinds).toEqual(['edit', 'edit', 'command', 'test', 'edit', 'test']);
  });

  it('contains zero un-redacted secrets from the raw session', () => {
    const serialized = JSON.stringify(events);
    for (const secret of RAW_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    // The path that embedded a secret survives, redacted.
    expect(serialized).toContain('«REDACTED:aws_access_key»');
  });

  it('never emits a content key (content|old_string|new_string|command)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event.data, keys);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('derives the session_end outcome from commits (committed)', () => {
    const end = events.find((e) => e.ev === 'session_end');
    expect(end?.data).toMatchObject({
      outcome: 'committed',
      turns: 3,
      duration_s: 1800,
    });
  });

  it('handles each payload well under the 20ms budget (p95)', () => {
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      for (const { hook, json } of payloads) {
        const start = performance.now();
        processHookPayload(hook, json, ctx);
        samples.push(performance.now() - start);
      }
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] as number;
    expect(p95).toBeLessThan(20);
  });
});
