import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_WORDS,
  lintMemoryText,
  memoryPath,
  serializeMemoryFile,
  type Memory,
} from '@teambrain/core';
import { importRepo } from './convert.js';

const REPOS_DIR = fileURLToPath(
  new URL('../../../../testdata/repos', import.meta.url),
);
const FIXED_NOW = { now: () => new Date('2026-07-03T10:00:00.000Z') };

function classCounts(candidates: Memory[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    counts[candidate.class] = (counts[candidate.class] ?? 0) + 1;
  }
  return counts;
}

function sourceTag(candidate: Memory): string {
  const tag = candidate.tags.find((entry) => entry.startsWith('source:'));
  expect(tag, candidate.title).toBeDefined();
  return tag as string;
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function listFilesRecursively(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

describe('importRepo: claude-md-only', () => {
  const repo = join(REPOS_DIR, 'claude-md-only');

  it('yields one convention per CLAUDE.md unit (preamble + 3 sections)', () => {
    const { candidates } = importRepo(repo, FIXED_NOW);
    expect(classCounts(candidates)).toEqual({ convention: 4 });
    expect(candidates.map((c) => c.title)).toEqual([
      'Acme Billing Service — agent guidelines',
      'Code style',
      'Testing',
      'Commit conventions',
    ]);
    expect(candidates.every((c) => c.created === '2026-07-03')).toBe(true);
    expect(candidates.every((c) => c.tags.includes('imported'))).toBe(true);
  });
});

describe('importRepo: cursor-heavy', () => {
  const repo = join(REPOS_DIR, 'cursor-heavy');

  it('maps rules to conventions and the README arch section to map', () => {
    const { candidates } = importRepo(repo, FIXED_NOW);
    expect(classCounts(candidates)).toEqual({ convention: 6, map: 1 });

    const mapCandidate = candidates.find((c) => c.class === 'map');
    expect(mapCandidate?.title).toBe('Architecture');
    expect(sourceTag(mapCandidate as Memory)).toBe(
      'source:README.md#architecture',
    );
  });

  it('uses the mdc description as the title when the body has no heading', () => {
    const { candidates } = importRepo(repo, FIXED_NOW);
    const titles = candidates.map((c) => c.title);
    expect(titles).toContain('TypeScript conventions for the storefront');
    // Bare files with no heading and no hint fall back to their path.
    expect(titles).toContain('.cursor/rules/testing.mdc');
    expect(titles).toContain('.cursorrules');
  });
});

describe('importRepo: adr-rich', () => {
  const repo = join(REPOS_DIR, 'adr-rich');

  it('maps ADRs to decisions, splitting the oversized one into parts', () => {
    const { candidates } = importRepo(repo, FIXED_NOW);
    expect(classCounts(candidates)).toEqual({ decision: 4, convention: 1 });

    const parts = candidates.filter((c) =>
      sourceTag(c).endsWith('0003-split-the-monolith-into-workspaces.md'),
    );
    expect(parts.map((c) => c.title)).toEqual([
      '3. Split the monolith into pnpm workspaces (part 1 of 2)',
      '3. Split the monolith into pnpm workspaces (part 2 of 2)',
    ]);
    // Linked memories share the source: tag and both respect the limit.
    expect(new Set(parts.map(sourceTag)).size).toBe(1);
    for (const part of parts) {
      expect(part.body.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(
        MAX_BODY_WORDS,
      );
    }
  });

  it('keeps small ADRs whole with their heading as title', () => {
    const { candidates } = importRepo(repo, FIXED_NOW);
    const titles = candidates.map((c) => c.title);
    expect(titles).toContain('1. Use Postgres for transactional data');
    expect(titles).toContain(
      '2. Adopt event-driven integration between domains',
    );
    expect(titles).toContain('Working notes for agents');
  });
});

describe('importRepo: invariants across all fixture repos', () => {
  const repos = ['claude-md-only', 'cursor-heavy', 'adr-rich'];

  it('preserves ≥90% of each source text in bodies (Jaccard tokens)', () => {
    for (const repo of repos) {
      const { sources, candidates } = importRepo(join(REPOS_DIR, repo));
      for (const source of sources) {
        const bodies = candidates
          .filter((c) => sourceTag(c) === `source:${source.path}`)
          .map((c) => c.body)
          .join(' ');
        const overlap = jaccard(tokenSet(source.text), tokenSet(bodies));
        expect(overlap, `${repo}/${source.path}`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  it('every candidate passes tb lint (schema, limits, injection, placement)', () => {
    for (const repo of repos) {
      const { candidates } = importRepo(join(REPOS_DIR, repo));
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        const violations = lintMemoryText(
          memoryPath(candidate),
          serializeMemoryFile(candidate),
        );
        expect(violations, `${repo}: ${candidate.title}`).toEqual([]);
      }
    }
  });

  it('never writes to the scanned repo', () => {
    for (const repo of repos) {
      const repoDir = join(REPOS_DIR, repo);
      const before = listFilesRecursively(repoDir);
      importRepo(repoDir);
      expect(listFilesRecursively(repoDir)).toEqual(before);
    }
  });
});
