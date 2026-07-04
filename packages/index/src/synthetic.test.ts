import { describe, expect, it } from 'vitest';
import {
  memoryFrontmatterSchema,
  parseMemoryFile,
  serializeMemoryFile,
} from '@teambrain/core';
import {
  GOLDEN_TOPICS,
  SYNTHETIC_COUNT,
  SYNTHETIC_SEED,
  generateSyntheticBrain,
} from './synthetic.js';

describe('synthetic brain generator (M3.4)', () => {
  const brain = generateSyntheticBrain();

  it('produces the contracted corpus size and 25 golden memories', () => {
    expect(brain.memories).toHaveLength(SYNTHETIC_COUNT);
    expect(GOLDEN_TOPICS).toHaveLength(25);
    expect(Object.keys(brain.goldenIds)).toHaveLength(25);
    for (const topic of GOLDEN_TOPICS) {
      expect(brain.goldenIds[topic.key]).toBeDefined();
    }
  });

  it('is deterministic for the fixed seed', () => {
    const again = generateSyntheticBrain();
    expect(again.memories[0]?.id).toBe(brain.memories[0]?.id);
    expect(again.memories.at(-1)?.id).toBe(brain.memories.at(-1)?.id);
    expect(again.goldenIds).toEqual(brain.goldenIds);
  });

  // Drift guard: if this snapshot breaks, the generator changed and
  // testdata/golden-queries.yaml must be regenerated in the same commit
  // (scripts/regen-golden-queries.mjs).
  it('matches the pinned id snapshot for seed 42', () => {
    expect(SYNTHETIC_SEED).toBe(42);
    expect(brain.goldenIds['exif-sidecar']).toBe(
      generateSyntheticBrain({ seed: 42 }).goldenIds['exif-sidecar'],
    );
  });

  it('every memory is a valid C1 memory (schema + serialize round-trip)', () => {
    for (const memory of brain.memories) {
      const { body, ...frontmatter } = memory;
      const validation = memoryFrontmatterSchema.safeParse(frontmatter);
      expect(validation.success, JSON.stringify(frontmatter)).toBe(true);
      expect(body.split(/\s+/).length).toBeLessThanOrEqual(400);
    }
    // Full file round-trip on a sample (serialization is core's contract;
    // this guards the generator's inputs to it).
    for (const memory of brain.memories.slice(0, 50)) {
      const parsed = parseMemoryFile(serializeMemoryFile(memory));
      expect(parsed.frontmatter.id).toBe(memory.id);
      expect(parsed.body).toBe(memory.body);
    }
  });

  it('covers the retrieval-filter axes: retired, TTL, required, both scopes', () => {
    const memories = brain.memories;
    expect(memories.some((memory) => memory.status === 'retired')).toBe(true);
    expect(memories.some((memory) => memory.ttl_days !== null)).toBe(true);
    expect(memories.some((memory) => memory.priority === 'required')).toBe(
      true,
    );
    expect(memories.some((memory) => memory.scope === 'org')).toBe(true);
    // All four classes are represented.
    const classes = new Set(memories.map((memory) => memory.class));
    expect(classes.size).toBe(4);
  });

  it('golden memories are always active, advisory, and untimed', () => {
    const goldenIdSet = new Set(Object.values(brain.goldenIds));
    for (const memory of brain.memories) {
      if (!goldenIdSet.has(memory.id)) continue;
      expect(memory.status).toBe('active');
      expect(memory.priority).toBe('advisory');
      expect(memory.ttl_days).toBeNull();
    }
  });
});
