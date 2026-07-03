import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseSessionEventLine,
  serializeSessionEvent,
  SessionEventParseError,
} from './events.js';

function fixtureLines(name: string): string[] {
  const file = fileURLToPath(
    new URL(`../testdata/events/${name}`, import.meta.url),
  );
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('session event fixtures', () => {
  const validLines = fixtureLines('valid.jsonl');
  const invalidLines = fixtureLines('invalid.jsonl');

  it('covers every C2 event type', () => {
    const evs = new Set(
      validLines.map((line) => parseSessionEventLine(line).ev),
    );
    expect(evs).toEqual(
      new Set([
        'session_start',
        'intent',
        'memory_retrieved',
        'tool_use',
        'plan_revision',
        'candidate_proposed',
        'session_end',
      ]),
    );
  });

  it.each(validLines.map((line, i) => [i + 1, line]))(
    'valid line %i parses and round-trips',
    (_index, line) => {
      const event = parseSessionEventLine(line);
      expect(JSON.parse(serializeSessionEvent(event))).toEqual(
        JSON.parse(line),
      );
    },
  );

  it.each(invalidLines.map((line, i) => [i + 1, line]))(
    'invalid line %i is rejected',
    (_index, line) => {
      expect(() => parseSessionEventLine(line)).toThrow(SessionEventParseError);
    },
  );
});

describe('event schema details', () => {
  const baseEnvelope = {
    v: 1,
    sid: 's_x',
    t: '2026-07-02T09:14:03Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
  };

  it('caps intent summaries at 200 chars (never the raw prompt)', () => {
    const ok = {
      ...baseEnvelope,
      ev: 'intent',
      data: { summary: 'x'.repeat(200) },
    };
    expect(parseSessionEventLine(JSON.stringify(ok)).ev).toBe('intent');
    const tooLong = {
      ...baseEnvelope,
      ev: 'intent',
      data: { summary: 'x'.repeat(201) },
    };
    expect(() => parseSessionEventLine(JSON.stringify(tooLong))).toThrow(
      SessionEventParseError,
    );
  });

  it('accepts timezone offsets in t', () => {
    const offset = {
      ...baseEnvelope,
      t: '2026-07-02T11:14:03+02:00',
      ev: 'plan_revision',
      data: {},
    };
    expect(parseSessionEventLine(JSON.stringify(offset)).ev).toBe(
      'plan_revision',
    );
  });

  it('passes through unknown data fields (additive evolution)', () => {
    const line = JSON.stringify({
      ...baseEnvelope,
      ev: 'tool_use',
      data: { kind: 'edit', path: 'a.ts', future_field: 42 },
    });
    const event = parseSessionEventLine(line);
    expect((event.data as Record<string, unknown>)['future_field']).toBe(42);
    expect(JSON.parse(serializeSessionEvent(event))).toEqual(JSON.parse(line));
  });

  it('validates candidate drafts inside candidate_proposed', () => {
    const bad = {
      ...baseEnvelope,
      ev: 'candidate_proposed',
      data: { draft: { class: 'learning', title: '', body: 'b' } },
    };
    expect(() => parseSessionEventLine(JSON.stringify(bad))).toThrow(
      SessionEventParseError,
    );
  });
});
