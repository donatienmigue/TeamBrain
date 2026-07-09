import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionEventSchema } from '@teambrain/core';
import { CursorInterceptor, type CursorMcpCall } from './interceptor.js';

function fixturePayloads(): CursorMcpCall[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(
    here,
    '..',
    '..',
    '..',
    '..',
    'testdata',
    'sessions',
    'raw-cursor.jsonl',
  );
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CursorMcpCall);
}

describe('CursorInterceptor (C6.1 parity)', () => {
  it('translates Cursor MCP calls into C2-valid events', () => {
    const payloads = fixturePayloads();
    const interceptor = new CursorInterceptor({
      repo: 'acme/api',
      branch: 'main',
      tool: 'cursor',
      model: 'unknown',
      redactionLevel: 'strict',
      now: () => new Date('2026-07-06T12:00:00.000Z'),
    });

    const events = payloads.flatMap((p) => interceptor.processCall(p));

    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(() => sessionEventSchema.parse(event)).not.toThrow();
    }

    expect(events.map((e) => e.ev)).toEqual([
      'session_start',
      'candidate_proposed',
      'session_end',
    ]);
  });
});
