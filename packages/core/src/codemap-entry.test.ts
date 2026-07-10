import { describe, expect, it } from 'vitest';
import {
  CodemapEntryParseError,
  parseCodemapEntry,
  serializeCodemapEntry,
} from './codemap-entry.js';

const HASH = 'a'.repeat(64);

describe('codemap entry format (D6/R16)', () => {
  const entry = {
    frontmatter: {
      v: 1 as const,
      path: 'src/digest/aggregate.ts',
      hash: HASH,
      updated: '2026-07-10',
    },
    body: 'Aggregates people-free digest metrics.\n\nEntry points: aggregateDigest.',
  };

  it('round-trips byte-exactly (serialize → parse → serialize)', () => {
    const once = serializeCodemapEntry(entry);
    const parsed = parseCodemapEntry(once);
    expect(parsed.frontmatter).toEqual(entry.frontmatter);
    expect(parsed.body).toBe(entry.body);
    expect(serializeCodemapEntry(parsed)).toBe(once);
  });

  it('quotes YAML-hostile paths safely', () => {
    const hostile = {
      ...entry,
      frontmatter: { ...entry.frontmatter, path: 'a: b/#weird [x].ts' },
    };
    const parsed = parseCodemapEntry(serializeCodemapEntry(hostile));
    expect(parsed.frontmatter.path).toBe('a: b/#weird [x].ts');
  });

  it('negative: rejects a missing front-matter block', () => {
    expect(() => parseCodemapEntry('just a body')).toThrow(
      CodemapEntryParseError,
    );
  });

  it('negative: rejects a bad hash', () => {
    const bad = serializeCodemapEntry(entry).replace(HASH, 'nothex');
    expect(() => parseCodemapEntry(bad)).toThrow(CodemapEntryParseError);
  });
});

describe('brain config codemap block', () => {
  it('defaults codemap.enabled to false and accepts true', async () => {
    const { parseBrainConfig } = await import('./brain-config.js');
    expect(parseBrainConfig('version: 1\n').codemap.enabled).toBe(false);
    expect(
      parseBrainConfig('version: 1\ncodemap:\n  enabled: true\n').codemap
        .enabled,
    ).toBe(true);
  });
});
