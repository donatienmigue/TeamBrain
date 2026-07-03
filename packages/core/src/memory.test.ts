import { describe, expect, it } from 'vitest';
import { memoryFrontmatterSchema, memoryPath } from './memory.js';
import { ulid } from './ulid.js';

function validFrontmatter() {
  return {
    id: ulid(),
    class: 'learning' as const,
    scope: 'team' as const,
    status: 'active' as const,
    priority: 'advisory' as const,
    title: 'S3 client needs custom retry wrapper',
    created: '2026-07-02',
    supersedes: [],
    tags: ['aws'],
    ttl_days: null,
  };
}

describe('memoryFrontmatterSchema', () => {
  it('accepts valid front-matter, with and without evidence', () => {
    expect(memoryFrontmatterSchema.parse(validFrontmatter())).toBeTruthy();
    expect(
      memoryFrontmatterSchema.parse({
        ...validFrontmatter(),
        evidence: { sessions: ['s_1'], commits: [] },
      }),
    ).toBeTruthy();
  });

  it('rejects unknown keys (strict per C1)', () => {
    expect(
      memoryFrontmatterSchema.safeParse({
        ...validFrontmatter(),
        proposer: 'distiller',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid ids, classes, titles, dates and ttl values', () => {
    const base = validFrontmatter();
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, id: 'nope' }).success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, class: 'insight' }).success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, title: '' }).success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, title: 'x'.repeat(81) })
        .success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, created: '2026-2-3' })
        .success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, created: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, ttl_days: 1.5 }).success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, ttl_days: undefined })
        .success,
    ).toBe(false);
  });

  it('rejects non-ULID supersedes entries and malformed evidence', () => {
    const base = validFrontmatter();
    expect(
      memoryFrontmatterSchema.safeParse({ ...base, supersedes: ['abc'] })
        .success,
    ).toBe(false);
    expect(
      memoryFrontmatterSchema.safeParse({
        ...base,
        evidence: { sessions: ['s_1'] },
      }).success,
    ).toBe(false);
  });
});

describe('memoryPath', () => {
  it('builds the C1 path from class dir, id and slug', () => {
    const id = ulid();
    expect(
      memoryPath({
        id,
        class: 'learning',
        title: 'S3 client needs custom retry wrapper',
      }),
    ).toBe(`memories/learnings/${id}-s3-client-needs-custom-retry-wrapper.md`);
    expect(memoryPath({ id, class: 'decision', title: 'A' })).toBe(
      `memories/decisions/${id}-a.md`,
    );
    expect(memoryPath({ id, class: 'convention', title: 'B' })).toBe(
      `memories/conventions/${id}-b.md`,
    );
    expect(memoryPath({ id, class: 'map', title: 'C' })).toBe(
      `memories/map/${id}-c.md`,
    );
  });
});
