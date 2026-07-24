import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeSessionEvent } from '@teambrain/core';
import { distill } from './pipeline.js';
import { DEFAULT_MAX_PROPOSALS } from './gate.js';
import { fakeProvider, fixtureResponder } from './fake-provider.js';
import { event, lexicalEmbedder, record } from './test-helpers.js';
import type { SessionSource } from './sessions.js';
import type { SessionRecord } from './types.js';
import type { ExistingMemory } from './brain-memories.js';

// A4 accept: agent candidates (memory_propose → candidate_proposed on
// teambrain/sessions) are first-class in the distiller — collected, drafted
// without a Provider call, deduped/conflict-checked, and gated under the same
// N≤10 cap as distiller clusters, carrying their proposing-session evidence.
// Fully offline: FakeProvider + a deterministic lexical embedder.

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** A SessionSource over in-memory records — the golden fixture without git. */
function staticSource(records: SessionRecord[]): SessionSource {
  return { head: () => 'head', readNewRecords: () => records };
}

/** A Provider that fails if called — asserts agent candidates need no draft call. */
const noProviderCall = fakeProvider(() => {
  throw new Error('no Provider call expected for a pure agent-candidate run');
});

const noPrs = { readMergedPRs: () => [], readTeamBrainPRBodies: () => [] };
const NOW = new Date('2026-07-24T00:00:00.000Z');

function agentSession(
  sid: string,
  draft: { class: string; title: string; body: string; tags?: string[] },
  commitShas: string[] = [],
): SessionRecord {
  return record(
    sid,
    [
      event(sid, 'session_start', {}),
      event(sid, 'candidate_proposed', { draft }),
      event(sid, 'session_end', {
        outcome: 'committed',
        duration_s: 5,
        turns: 2,
        commit_shas: commitShas,
      }),
    ],
    commitShas,
  );
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `01JD${String(idCounter).padStart(2, '0')}${'0'.repeat(20)}`;
}

describe('distill — agent candidates (A4)', () => {
  it('surfaces an agent proposal in the PR body carrying its session evidence', async () => {
    const sid = '01J9AGENTAAAAAAAAAAAAAAAAAA';
    const outcome = await distill({
      repoRoot: '/unused',
      brainDir: '/unused',
      sessions: staticSource([
        agentSession(
          sid,
          {
            class: 'convention',
            title: 'Wrap each migration in a transaction',
            body: 'Run every migration inside BEGIN/COMMIT so a mid-migration failure rolls back cleanly.',
            tags: ['db'],
          },
          ['deadbeefcafe'],
        ),
      ]),
      existing: [],
      provider: noProviderCall,
      embed: lexicalEmbedder(),
      prs: noPrs,
      now: NOW,
      newId,
    });

    expect(outcome.proposals).toHaveLength(1);
    const proposal = outcome.proposals[0]!;
    expect(proposal.memory.title).toBe('Wrap each migration in a transaction');
    expect(proposal.memory.class).toBe('convention');
    // The distiller stamps the proposing session (+ its commits) as evidence.
    expect(proposal.memory.evidence?.sessions).toEqual([sid]);
    expect(proposal.memory.evidence?.commits).toEqual(['deadbeefcafe']);
    // `tb distill --dry-run` renders exactly this PR body, evidence included.
    expect(outcome.prBody).toContain('Wrap each migration in a transaction');
    expect(outcome.prBody).toContain('1 session(s) · 1 commit(s)');
  });

  it('drops an agent proposal that duplicates an existing memory (distiller is the dedup authority)', async () => {
    const existing: ExistingMemory[] = [
      {
        id: '01J8EXISTING0000000000000A',
        title: 'Cache user sessions in Redis',
        body: 'Store session state in Redis with a 30-minute TTL.',
      },
    ];
    const outcome = await distill({
      repoRoot: '/unused',
      brainDir: '/unused',
      sessions: staticSource([
        // Byte-identical to the existing memory → cosine 1.0 ≥ 0.85 → dropped.
        agentSession('01J9AGENTBBBBBBBBBBBBBBBBBB', {
          class: 'decision',
          title: 'Cache user sessions in Redis',
          body: 'Store session state in Redis with a 30-minute TTL.',
        }),
      ]),
      existing,
      provider: fakeProvider(fixtureResponder([], { verdict: 'consistent' })),
      embed: lexicalEmbedder(),
      prs: noPrs,
      now: NOW,
      newId,
    });

    expect(outcome.droppedDuplicates).toBe(1);
    expect(outcome.proposals).toHaveLength(0);
  });

  it('gates agent + distiller candidates together under DEFAULT_MAX_PROPOSALS', async () => {
    // 12 distinct agent candidates + one distiller no-hit signal = 13 clusters,
    // capped to 10 in the shared gate.
    const records: SessionRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push(
        agentSession(`01J9AGENT${String(i).padStart(2, '0')}0000000000000`, {
          class: 'learning',
          title: `Agent lesson number ${i}`,
          body: `A distinct, non-duplicate lesson the agent proposed, index ${i}.`,
        }),
      );
    }
    // A distiller no-hit cluster (≥ minNoHits=2 no-hit searches in one session).
    const distSid = '01J9DISTILLER000000000000000';
    records.push(
      record(distSid, [
        event(distSid, 'session_start', {}),
        event(distSid, 'memory_retrieved', { ids: [] }),
        event(distSid, 'memory_retrieved', { ids: [] }),
        event(distSid, 'session_end', {
          outcome: 'abandoned',
          duration_s: 1,
          turns: 2,
          commit_shas: [],
        }),
      ]),
    );

    const outcome = await distill({
      repoRoot: '/unused',
      brainDir: '/unused',
      sessions: staticSource(records),
      existing: [],
      provider: fakeProvider(
        fixtureResponder(
          [
            {
              match: 'SIGNAL: no_hit_search',
              value: {
                class: 'map',
                title: 'Document the repeatedly-missed topic',
                body: 'Several searches returned nothing; capture where this lives.',
                tags: [],
              },
            },
          ],
          { verdict: 'consistent' },
        ),
      ),
      embed: lexicalEmbedder(),
      prs: noPrs,
      now: NOW,
      newId,
    });

    expect(outcome.clusters).toBe(13);
    expect(outcome.proposals).toHaveLength(DEFAULT_MAX_PROPOSALS);
  });

  it('reads candidate_proposed off the real teambrain/sessions branch (collect)', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'tb-distill-repo-'));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['commit', '-q', '--allow-empty', '-m', 'init']);

    // Write a session record onto an orphan teambrain/sessions branch.
    const sid = '01J9BRANCHAGENT000000000000';
    const events = [
      event(sid, 'session_start', {}),
      event(sid, 'candidate_proposed', {
        draft: {
          class: 'learning',
          title: 'Set GIT_INDEX_FILE for offline session commits',
          body: 'Commit onto the sessions branch with a throwaway index; no worktree checkout.',
        },
      }),
      event(sid, 'session_end', {
        outcome: 'committed',
        duration_s: 3,
        turns: 1,
        commit_shas: ['abc123'],
      }),
    ];
    // Orphan branch off an empty-commit repo: the index is already empty, so
    // there is nothing to `git rm` — just stage the session record.
    git(['checkout', '-q', '--orphan', 'teambrain/sessions']);
    mkdirSync(join(repo, 'sessions'), { recursive: true });
    writeFileSync(
      join(repo, 'sessions', `${sid}.jsonl`),
      events.map(serializeSessionEvent).join('\n') + '\n',
      'utf8',
    );
    git(['add', 'sessions']);
    git(['commit', '-q', '-m', 'session']);
    git(['checkout', '-q', 'main']);

    // Default gitSessionSource(repoRoot) reads the branch — the CI path.
    const outcome = await distill({
      repoRoot: repo,
      existing: [],
      provider: noProviderCall,
      embed: lexicalEmbedder(),
      prs: noPrs,
      now: NOW,
      newId,
    });

    expect(
      outcome.proposals.map((proposal) => proposal.memory.title),
    ).toContain('Set GIT_INDEX_FILE for offline session commits');
    const proposal = outcome.proposals.find(
      (candidate) =>
        candidate.memory.title ===
        'Set GIT_INDEX_FILE for offline session commits',
    )!;
    expect(proposal.memory.evidence?.sessions).toEqual([sid]);
  });
});
