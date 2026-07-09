import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@teambrain/core';
import {
  fakeProvider,
  type EmbedFn,
  type SessionRecord,
  type SessionSource,
} from '@teambrain/distill';
import { runDistillCommand } from './distill-command.js';

// M6.4 CLI dry-run: verifies the command wires the pipeline and prints the
// would-be PR with zero git side effects. Runs offline via injected fake
// provider + embedder + session source (no network, no branch created).

function ev(
  sid: string,
  evName: SessionEvent['ev'],
  data: object,
): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-05T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/web',
    branch: 'main',
    ev: evName,
    data,
  } as SessionEvent;
}

// Two sessions editing the same path → one path_struggle cluster.
const records: SessionRecord[] = [
  {
    sid: 's1',
    events: [ev('s1', 'tool_use', { kind: 'edit', path: 'src/a.ts' })],
    commitShas: ['c1'],
  },
  {
    sid: 's2',
    events: [ev('s2', 'tool_use', { kind: 'edit', path: 'src/a.ts' })],
    commitShas: ['c2'],
  },
];

const sessions: SessionSource = {
  head: () => 'tip',
  readNewRecords: () => records,
};

const constEmbed: EmbedFn = (texts) =>
  Promise.resolve(texts.map(() => Float32Array.from([1, 0, 0])));

const provider = fakeProvider(() => ({
  class: 'learning',
  title: 'Guard the config parser against partial writes',
  body: 'Validate the config file exists and is complete before parsing it.',
  tags: ['config'],
}));

let brainDir: string;

beforeEach(() => {
  // A minimal but existing brain dir (no memories → nothing to dedup against).
  brainDir = mkdtempSync(join(tmpdir(), 'tb-distill-brain-'));
});

afterEach(() => {
  rmSync(brainDir, { recursive: true, force: true });
});

function proposalBranches(): string[] {
  const out = execFileSync(
    'git',
    ['branch', '--list', 'teambrain/proposals-*'],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

describe('tb distill --dry-run (M6.4)', () => {
  it('prints the would-be PR and creates no branch', async () => {
    const before = proposalBranches();

    const { exitCode, output } = await runDistillCommand('.', {
      dryRun: true,
      provider,
      embed: constEmbed,
      sessions,
      prs: { readMergedPRs: () => [], readTeamBrainPRBodies: () => [] },
      brainDir,
      now: new Date('2026-07-06T00:00:00Z'),
      newId: () => `01JD01${'0'.repeat(20)}`,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain('1 proposal(s)');
    expect(output).toContain('Would create these files:');
    expect(output).toContain('.teambrain/memories/learnings/');
    expect(output).toContain('--- PR body ---');

    // No git side effects: the proposals branch set is unchanged.
    expect(proposalBranches()).toEqual(before);
  });
});
