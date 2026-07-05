import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isUlid } from '@teambrain/core';
import { createTools } from './tools.js';
import {
  FIXTURE_IDS,
  fixtureBrainDir,
  indexForBrain,
  tempRuntimeDir,
  toolContextFor,
} from './test-helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tools() {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  const runtimeDir = await tempRuntimeDir(cleanups);
  const context = toolContextFor(index, runtimeDir);
  return { tools: createTools(context), context, runtimeDir };
}

describe('memory_search', () => {
  it('returns ranked C3 memory views for a query', async () => {
    const { tools: t } = await tools();
    const results = await t.memorySearch({ query: 'zod validation boundary' });
    expect(results[0]?.id).toBe(FIXTURE_IDS.requiredZod);
    expect(results[0]?.provenance).toContain('conventions/');
    expect(results[0]?.class).toBe('convention');
  });

  it('honors k', async () => {
    const { tools: t } = await tools();
    const results = await t.memorySearch({ query: 'daemon index search', k: 1 });
    expect(results).toHaveLength(1);
  });
});

describe('memory_context', () => {
  it('returns required-first within budget', async () => {
    const { tools: t } = await tools();
    const context = t.memoryContext();
    expect(context.required.map((memory) => memory.id)).toEqual([
      FIXTURE_IDS.requiredZod,
    ]);
    expect(context.token_estimate).toBeLessThanOrEqual(2000);
  });
});

describe('memory_propose', () => {
  it('spools a candidate and returns its id (nothing touches the brain)', async () => {
    const { tools: t, runtimeDir } = await tools();
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
      },
    });
    expect(result.queued).toBe(true);
    expect(isUlid(result.candidate_id)).toBe(true);
    const spoolDir = join(runtimeDir, 'spool', 'candidates');
    const files = readdirSync(spoolDir);
    expect(files).toEqual([`${result.candidate_id}.json`]);
    const record = JSON.parse(
      readFileSync(join(spoolDir, files[0] as string), 'utf8'),
    );
    expect(record.draft.title).toBe('Prefer WAL mode for concurrent readers');
  });

  it('rejects a draft that fails schema validation', async () => {
    const { tools: t } = await tools();
    expect(() =>
      t.memoryPropose({
        // @ts-expect-error deliberately invalid class at the boundary
        draft: { class: 'not-a-class', title: 'x', body: 'y' },
      }),
    ).toThrow();
  });
});

describe('memory_feedback', () => {
  it('appends a feedback signal and returns ok', async () => {
    const { tools: t, runtimeDir } = await tools();
    expect(t.memoryFeedback({ id: FIXTURE_IDS.mapDaemon, useful: true })).toEqual(
      { ok: true },
    );
    const line = readFileSync(
      join(runtimeDir, 'spool', 'feedback.jsonl'),
      'utf8',
    ).trim();
    expect(JSON.parse(line)).toMatchObject({
      id: FIXTURE_IDS.mapDaemon,
      useful: true,
    });
  });
});
