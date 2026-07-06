import { describe, it, expect } from 'vitest';
import type { Memory } from '@teambrain/core';
import { dedupCandidates } from './dedup.js';
import { fakeProvider, fixtureResponder } from './fake-provider.js';
import { lexicalEmbedder } from './test-helpers.js';
import type { ExistingMemory } from './brain-memories.js';
import type { DraftedCandidate } from './draft.js';
import type { Cluster } from './types.js';

const cluster: Cluster = {
  kind: 'path_struggle',
  key: 'k',
  sessions: ['s1'],
  commits: [],
  strength: 1,
  detail: {},
};

function candidate(title: string, body: string): DraftedCandidate {
  const memory: Memory = {
    id: '0'.repeat(26),
    class: 'learning',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title,
    created: '2026-07-06',
    evidence: { sessions: ['s1'], commits: [] },
    supersedes: [],
    tags: [],
    ttl_days: null,
    body,
  };
  return { memory, cluster };
}

const embed = lexicalEmbedder();
// A provider that never flags a conflict — isolates the dedup path.
const noConflict = fakeProvider(
  fixtureResponder([], { verdict: 'consistent' }),
);

describe('dedupCandidates (M6.3)', () => {
  it('drops a candidate whose cosine ≥ threshold against an existing memory', async () => {
    const existing: ExistingMemory[] = [
      {
        id: 'E1',
        title: 'Squash migrations before merging',
        body: 'Squash all migration files into one before merging a branch.',
      },
    ];
    const dup = candidate(
      'Squash migrations before merging',
      'Squash all migration files into one before merging a branch.',
    );
    const result = await dedupCandidates([dup], {
      embed,
      provider: noConflict,
      existing,
    });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.duplicateOfId).toBe('E1');
    expect(result.dropped[0]!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps a novel candidate with novelty = 1 − maxSim', async () => {
    const existing: ExistingMemory[] = [
      {
        id: 'E1',
        title: 'Cats nap often',
        body: 'Cats love to sleep all day.',
      },
    ];
    const novel = candidate(
      'Rotate the deployment keys quarterly',
      'Rotate production deployment credentials every quarter for safety.',
    );
    const result = await dedupCandidates([novel], {
      embed,
      provider: noConflict,
      existing,
    });
    expect(result.dropped).toHaveLength(0);
    expect(result.kept).toHaveLength(1);
    const kept = result.kept[0]!;
    expect(kept.maxSim).toBeLessThan(0.85);
    expect(kept.novelty).toBeCloseTo(1 - kept.maxSim, 10);
    expect(kept.conflict).toBeUndefined();
    expect(kept.memory.supersedes).toEqual([]);
  });

  it('sets supersedes + a conflict flag when the Provider reports a contradiction', async () => {
    const existing: ExistingMemory[] = [
      {
        id: 'E-DEPLOY',
        title: 'Deploy on Friday afternoons',
        body: 'Always ship the weekly release on Friday afternoon.',
      },
    ];
    const contra = candidate(
      'Never deploy on Fridays',
      'Do not ship releases on a Friday; wait until Monday morning.',
    );
    const provider = fakeProvider(
      fixtureResponder(
        [
          {
            match: 'Never deploy on Fridays',
            value: { verdict: 'contradicts', reason: 'opposite ship-day rule' },
          },
        ],
        { verdict: 'consistent' },
      ),
    );
    const result = await dedupCandidates([contra], {
      embed,
      provider,
      existing,
    });
    expect(result.dropped).toHaveLength(0);
    expect(result.kept).toHaveLength(1);
    const kept = result.kept[0]!;
    expect(kept.conflict?.supersedesId).toBe('E-DEPLOY');
    expect(kept.conflict?.reason).toBe('opposite ship-day rule');
    expect(kept.memory.supersedes).toEqual(['E-DEPLOY']);
  });

  it('keeps everything when there are no existing memories (maxSim 0, novelty 1)', async () => {
    const result = await dedupCandidates([candidate('T', 'B')], {
      embed,
      provider: noConflict,
      existing: [],
    });
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.maxSim).toBe(0);
    expect(result.kept[0]!.novelty).toBe(1);
  });
});
