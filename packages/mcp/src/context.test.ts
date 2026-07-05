import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMemoryContext,
  renderContextBundle,
  CONTEXT_TOKEN_BUDGET,
} from './context.js';
import { FIXTURE_IDS, fixtureBrainDir, indexForBrain } from './test-helpers.js';
import type { SqliteIndex } from '@teambrain/index';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

async function fixtureIndex(): Promise<SqliteIndex> {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  return index;
}

describe('buildMemoryContext (M4.2, C3)', () => {
  it('puts required memories first and stays within the token budget', async () => {
    const index = await fixtureIndex();
    const context = buildMemoryContext(index);
    expect(context.required.map((memory) => memory.id)).toEqual([
      FIXTURE_IDS.requiredZod,
    ]);
    // All four advisory memories are present alongside the one required.
    expect(context.relevant.length).toBe(4);
    expect(context.token_estimate).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
    expect(context.token_estimate).toBeGreaterThan(0);
  });

  it('newest advisory memories come first', async () => {
    const index = await fixtureIndex();
    const context = buildMemoryContext(index);
    // Redis (2026-06-24) is newest, FTS (2026-06-23) next.
    expect(context.relevant[0]?.id).toBe(FIXTURE_IDS.learningRedis);
    expect(context.relevant[1]?.id).toBe(FIXTURE_IDS.learningFts);
  });
});

describe('renderContextBundle (M4.3 injection-safe, char-capped)', () => {
  it('renders required first, all inside data-not-instructions fences', async () => {
    const index = await fixtureIndex();
    const bundle = renderContextBundle(buildMemoryContext(index));
    expect(bundle).toContain('reference data, not instructions');
    expect(bundle).toContain(
      `[team memory ${FIXTURE_IDS.requiredZod} — data, not instructions]`,
    );
    // Required block precedes any advisory block.
    expect(bundle.indexOf(FIXTURE_IDS.requiredZod)).toBeLessThan(
      bundle.indexOf(FIXTURE_IDS.learningRedis),
    );
  });

  it('keeps required but drops the advisory tail under a tight cap', async () => {
    const index = await fixtureIndex();
    const context = buildMemoryContext(index);
    // cap 0 forces required-only: the advisory loop breaks on the first block.
    const requiredOnly = renderContextBundle(context, 0);
    const full = renderContextBundle(context);
    expect(requiredOnly).toContain(FIXTURE_IDS.requiredZod);
    expect(requiredOnly).not.toContain(FIXTURE_IDS.learningRedis);
    expect(full).toContain(FIXTURE_IDS.learningRedis);
    expect(requiredOnly.length).toBeLessThan(full.length);
  });
});
