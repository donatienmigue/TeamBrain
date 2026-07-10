import { describe, it, expect } from 'vitest';
import type { Memory } from '@teambrain/core';
import { gateCandidates, renderPrBody } from './gate.js';
import type { DedupedCandidate } from './dedup.js';
import type { Cluster } from './types.js';

const cluster: Cluster = {
  kind: 'path_struggle',
  key: 'k',
  sessions: ['s1'],
  commits: [],
  strength: 1,
  detail: {},
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `01JD${String(counter).padStart(2, '0')}${'0'.repeat(20)}`;
}

function deduped(
  title: string,
  sessions: string[],
  commits: string[],
  novelty: number,
  conflict?: { supersedesId: string; reason: string },
): DedupedCandidate {
  const memory: Memory = {
    id: nextId(),
    class: 'learning',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title,
    created: '2026-07-06',
    evidence: { sessions, commits },
    supersedes: conflict ? [conflict.supersedesId] : [],
    tags: [],
    ttl_days: null,
    body: `Body for ${title}.`,
  };
  return {
    memory,
    cluster,
    maxSim: 1 - novelty,
    novelty,
    ...(conflict === undefined ? {} : { conflict }),
  };
}

describe('gateCandidates (M6.4)', () => {
  it('scores evidence_count × novelty and ranks descending', () => {
    const proposals = gateCandidates([
      deduped('low', ['s1'], [], 0.5), // 1 * 0.5 = 0.5
      deduped('high', ['s1', 's2'], ['c1'], 0.9), // 3 * 0.9 = 2.7
      deduped('mid', ['s1', 's2'], [], 0.5), // 2 * 0.5 = 1.0
    ]);
    expect(proposals.map((p) => p.memory.title)).toEqual([
      'high',
      'mid',
      'low',
    ]);
    expect(proposals[0]!.score).toBeCloseTo(2.7, 10);
    expect(proposals[0]!.evidenceCount).toBe(3);
  });

  it('caps at the top N proposals', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      deduped(`m${i}`, ['s1'], [], (i + 1) / 20),
    );
    expect(gateCandidates(many, 10)).toHaveLength(10);
  });

  it('assigns the C1 memory path for each proposal', () => {
    const [proposal] = gateCandidates([deduped('a', ['s1'], [], 0.5)]);
    expect(proposal!.path).toMatch(/^memories\/learnings\/.*\.md$/);
  });
});

describe('renderPrBody (M6.4)', () => {
  it('renders a summary table and flags supersedes', () => {
    const body = renderPrBody(
      gateCandidates([
        deduped('Novel thing', ['s1', 's2'], [], 0.8),
        deduped('Conflicting thing', ['s1'], ['c1'], 0.6, {
          supersedesId: '01J8YCTS00000000000000000',
          reason: 'opposite rule',
        }),
      ]),
    );
    expect(body).toContain('| Class | Title | Evidence | Novelty | Score |');
    expect(body).toContain('Novel thing');
    expect(body).toContain('Supersedes existing memories');
    expect(body).toContain('01J8YCTS00000000000000000');
    expect(body).toContain('opposite rule');
  });

  it('handles the empty case without a table', () => {
    expect(renderPrBody([])).toContain('No memory candidates survived');
  });
});

describe('renderPrBody golden output (D3.1 — <60s/candidate review)', () => {
  function fixedProposal(
    id: string,
    title: string,
    conflict?: { supersedesId: string; reason: string },
  ): DedupedCandidate {
    const memory: Memory = {
      id,
      class: 'learning',
      scope: 'team',
      status: 'active',
      priority: 'advisory',
      title,
      created: '2026-07-06',
      evidence: { sessions: ['s1', 's2'], commits: ['abc1234'] },
      supersedes: conflict ? [conflict.supersedesId] : [],
      tags: [],
      ttl_days: null,
      body: `Body for ${title}.`,
    };
    return {
      memory,
      cluster,
      maxSim: 0.2,
      novelty: 0.8,
      ...(conflict === undefined ? {} : { conflict }),
    };
  }

  it('matches the golden PR body byte for byte', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const golden = readFileSync(
      fileURLToPath(
        new URL(
          '../../../testdata/golden/distiller-pr-body.md',
          import.meta.url,
        ),
      ),
      'utf8',
    ).replace(/\r\n/g, '\n');

    const body = renderPrBody(
      gateCandidates([
        fixedProposal('01JDGOLD01000000000000000A', 'Retry the S3 client'),
        fixedProposal(
          '01JDGOLD02000000000000000B',
          'Pin the sqlite-vec version',
          {
            supersedesId: '01J8YCTS0000000000000000',
            reason: 'opposite rule',
          },
        ),
      ]),
    );
    expect(body).toBe(golden);
  });

  it('has a verdict row, collapsible detail, and partial-accept command per candidate', () => {
    const body = renderPrBody(
      gateCandidates([fixedProposal('01JDGOLD01000000000000000A', 'One')]),
    );
    expect(body).toContain('| learning | One |');
    expect(body).toContain('<details>');
    expect(body).toContain('Body for One.');
    expect(body).toContain('# git rm "memories/learnings/');
  });
});
