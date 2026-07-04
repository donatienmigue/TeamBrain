import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGoldenQueries } from './golden-queries.js';
import {
  GOLDEN_TOPICS,
  SYNTHETIC_COUNT,
  SYNTHETIC_SEED,
  generateSyntheticBrain,
} from './synthetic.js';

const FIXTURE_PATH = join(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'testdata',
  'golden-queries.yaml',
);

describe('testdata/golden-queries.yaml (M3.4 fixture)', () => {
  it('parses, validates, and holds 25 pairs for the pinned seed', async () => {
    const golden = await loadGoldenQueries(FIXTURE_PATH);
    expect(golden.seed).toBe(SYNTHETIC_SEED);
    expect(golden.count).toBe(SYNTHETIC_COUNT);
    expect(golden.queries).toHaveLength(25);
    const keys = golden.queries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(25);
    expect(keys.sort()).toEqual(GOLDEN_TOPICS.map((topic) => topic.key).sort());
  });

  it('pins exactly the ids the generator produces (no fixture drift)', async () => {
    const golden = await loadGoldenQueries(FIXTURE_PATH);
    const { goldenIds } = generateSyntheticBrain({
      seed: golden.seed,
      count: golden.count,
    });
    for (const entry of golden.queries) {
      expect(entry.expected_id, `key ${entry.key}`).toBe(goldenIds[entry.key]);
    }
  });

  it('queries paraphrase rather than quote the golden titles', async () => {
    const golden = await loadGoldenQueries(FIXTURE_PATH);
    const titles = new Map(
      GOLDEN_TOPICS.map((topic) => [topic.key, topic.title.toLowerCase()]),
    );
    for (const entry of golden.queries) {
      expect(entry.query.toLowerCase()).not.toBe(titles.get(entry.key));
    }
  });
});
