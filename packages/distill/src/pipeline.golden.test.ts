import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  lintMemoryText,
  memoryPath,
  serializeMemoryFile,
} from '@teambrain/core';
import { distill } from './pipeline.js';
import { fakeProvider, type FakeRequestView } from './fake-provider.js';
import { fixtureSessionSource, lexicalEmbedder } from './test-helpers.js';
import type { DraftOutput } from './draft.js';

// M6 Accept — the golden pipeline test. testdata/sessions/week-fixture holds 12
// synthetic sessions engineered to yield exactly 4 draftable clusters: three
// that become proposals (one contradicting an existing memory) and one that
// duplicates an existing memory and is dropped. FakeProvider + a deterministic
// lexical embedder keep the whole run offline and reproducible. distill() does
// no git work, so this is also the `tb distill --dry-run` code path.

const FIXTURE = fileURLToPath(
  new URL('../../../testdata/sessions/week-fixture', import.meta.url),
);

const CONTRA_EXISTING_ID = '01J8YCTS000000000000000000';
const DUP_TITLE = 'Squash database migrations before merging';
const CONTRA_TITLE = 'Rely on CI for the slow integration test suite';

let drafts: Record<string, DraftOutput>;

beforeAll(() => {
  drafts = JSON.parse(
    readFileSync(join(FIXTURE, 'drafts.json'), 'utf8'),
  ) as Record<string, DraftOutput>;
});

/** Answers draft calls from the recorded fixtures and conflict calls by rule. */
function responder({ prompt }: FakeRequestView): unknown {
  if (prompt.includes('CONTRADICTION CHECK')) {
    const contradicts =
      prompt.includes(CONTRA_TITLE) &&
      prompt.includes('Run the full test suite locally before pushing');
    return contradicts
      ? { verdict: 'contradicts', reason: 'local full suite vs. CI-only' }
      : { verdict: 'consistent' };
  }
  const key = /KEY: (.+)/.exec(prompt)?.[1]?.trim();
  const draft = key === undefined ? undefined : drafts[key];
  if (draft === undefined) throw new Error(`no recorded draft for key ${key}`);
  return draft;
}

async function runPipeline() {
  let counter = 0;
  const newId = (): string => {
    counter += 1;
    return `01JD${String(counter).padStart(2, '0')}${'0'.repeat(20)}`;
  };
  return distill({
    repoRoot: FIXTURE,
    brainDir: join(FIXTURE, 'brain'),
    provider: fakeProvider(responder),
    embed: lexicalEmbedder(),
    sessions: fixtureSessionSource(join(FIXTURE, 'sessions')),
    prs: { readMergedPRs: () => [], readTeamBrainPRBodies: () => [] },
    now: new Date('2026-07-06T00:00:00Z'),
    newId,
  });
}

describe('distill golden pipeline (M6 Accept)', () => {
  it('clusters exactly four signals with no discarded drafts', async () => {
    const outcome = await runPipeline();
    expect(outcome.clusters).toBe(4);
    expect(outcome.discardedDrafts).toBe(0);
  });

  it('produces exactly 3 proposals and drops the 1 duplicate', async () => {
    const outcome = await runPipeline();
    expect(outcome.proposals).toHaveLength(3);
    expect(outcome.droppedDuplicates).toBe(1);
    const titles = outcome.proposals.map((p) => p.memory.title);
    expect(titles).not.toContain(DUP_TITLE);
  });

  it('carries supersedes + a PR-body flag for the contradiction', async () => {
    const outcome = await runPipeline();
    const conflicting = outcome.proposals.filter(
      (p) => p.conflict !== undefined,
    );
    expect(conflicting).toHaveLength(1);
    const proposal = conflicting[0]!;
    expect(proposal.memory.title).toBe(CONTRA_TITLE);
    expect(proposal.conflict?.supersedesId).toBe(CONTRA_EXISTING_ID);
    expect(proposal.memory.supersedes).toEqual([CONTRA_EXISTING_ID]);

    expect(outcome.prBody).toContain('Supersedes existing memories');
    expect(outcome.prBody).toContain(CONTRA_EXISTING_ID);
  });

  it('emits proposals that all pass `tb lint --require-evidence`', async () => {
    const outcome = await runPipeline();
    for (const proposal of outcome.proposals) {
      const path = memoryPath(proposal.memory);
      const text = serializeMemoryFile(proposal.memory);
      const violations = lintMemoryText(path, text, { requireEvidence: true });
      expect(
        violations,
        `${proposal.memory.title}: ${JSON.stringify(violations)}`,
      ).toEqual([]);
    }
  });

  it('is deterministic across runs (same proposal set)', async () => {
    const a = await runPipeline();
    const b = await runPipeline();
    expect(a.proposals.map((p) => p.memory.title)).toEqual(
      b.proposals.map((p) => p.memory.title),
    );
  });
});
