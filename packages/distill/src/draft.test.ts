import { describe, it, expect } from 'vitest';
import { isUlid } from '@teambrain/core';
import { draftCandidates, loadDistillPrompt } from './draft.js';
import { fakeProvider } from './fake-provider.js';
import type { Cluster } from './types.js';

function cluster(key: string, sessions: string[], commits: string[]): Cluster {
  return {
    kind: 'path_struggle',
    key,
    sessions,
    commits,
    strength: sessions.length,
    detail: { path: key },
  };
}

const validDraft = {
  class: 'learning',
  title: 'Cache the parsed config once per process',
  body: 'Parse the config file once at startup and cache it.',
  tags: ['config'],
};

describe('draftCandidates (M6.2)', () => {
  it('builds a C1 candidate with evidence populated from the cluster', async () => {
    const provider = fakeProvider(() => validDraft);
    const result = await draftCandidates(
      [cluster('src/config.ts', ['s1', 's2'], ['c1'])],
      provider,
      { now: new Date('2026-07-06T00:00:00Z'), newId: () => 'x'.repeat(26) },
    );

    expect(result.discarded).toBe(0);
    expect(result.candidates).toHaveLength(1);
    const { memory } = result.candidates[0]!;
    expect(memory.class).toBe('learning');
    expect(memory.scope).toBe('team');
    expect(memory.status).toBe('active');
    expect(memory.priority).toBe('advisory');
    expect(memory.created).toBe('2026-07-06');
    expect(memory.ttl_days).toBeNull();
    expect(memory.supersedes).toEqual([]);
    // Evidence is populated straight from the cluster (C1 + M6.2).
    expect(memory.evidence).toEqual({
      sessions: ['s1', 's2'],
      commits: ['c1'],
    });
  });

  it('generates a real ULID id by default', async () => {
    const provider = fakeProvider(() => validDraft);
    const result = await draftCandidates([cluster('a', ['s1'], [])], provider);
    expect(isUlid(result.candidates[0]!.memory.id)).toBe(true);
  });

  it('discards and counts a cluster whose Provider output is invalid', async () => {
    // Missing required fields → schema.parse throws inside the provider.
    const provider = fakeProvider(() => ({ class: 'not-a-class' }));
    const result = await draftCandidates([cluster('a', ['s1'], [])], provider);
    expect(result.candidates).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it('drafts each cluster independently, mixing valid and invalid', async () => {
    const provider = fakeProvider(({ prompt }) =>
      prompt.includes('good') ? validDraft : { bogus: true },
    );
    const result = await draftCandidates(
      [cluster('good', ['s1'], []), cluster('bad', ['s2'], [])],
      provider,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.discarded).toBe(1);
  });
});

describe('loadDistillPrompt', () => {
  it('loads the versioned prompt packaged with the code', () => {
    const prompt = loadDistillPrompt();
    expect(prompt).toContain('TeamBrain distiller');
    expect(prompt.length).toBeGreaterThan(200);
  });
});
