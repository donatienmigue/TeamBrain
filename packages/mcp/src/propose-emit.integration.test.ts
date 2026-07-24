import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseSessionEventLine,
  type CandidateDraft,
  type SessionEvent,
} from '@teambrain/core';
import { loadRedactionCorpus } from '@teambrain/redact';
import { createTools, type ToolContext } from './tools.js';
import { Spool, SESSIONS_BRANCH } from './spool.js';
import {
  fixtureBrainDir,
  indexForBrain,
  tempRuntimeDir,
  toolContextFor,
} from './test-helpers.js';

// A3 accept: calling the propose path during a fixture session must append a
// `candidate_proposed` event that (a) validates against C2, (b) carries the
// redacted draft, and (c) is present in the committed teambrain/sessions
// record. The emit → daemon → Spool → sessions-branch flow is exercised here
// by wiring emitCandidateProposed to a real Spool (the socket hop is already
// covered by spool.integration + daemon.integration).

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-propose-repo-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  git(['commit', '-q', '--allow-empty', '-m', 'init'], dir);
  return dir;
}

function envelope(sid: string, ev: SessionEvent['ev'], data: object): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-24T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev,
    data,
  } as SessionEvent;
}

/**
 * Builds a ToolContext whose propose path spools locally AND emits a
 * candidate_proposed event into `spool` for `sid` — the same shape the
 * daemon-connected `tb mcp` wiring produces.
 */
async function proposeIntoSpool(
  sid: string,
  spool: Spool,
  runtimeDir: string,
): Promise<ToolContext> {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  const context = toolContextFor(index, runtimeDir);
  context.resolveEvidence = () => ({ sessions: [sid], commits: [] });
  context.emitCandidateProposed = (draft): void => {
    void spool.handle(envelope(sid, 'candidate_proposed', { draft }));
  };
  return context;
}

async function sessionEnd(spool: Spool, sid: string): Promise<void> {
  await spool.handle(
    envelope(sid, 'session_end', {
      outcome: 'unknown',
      duration_s: 1,
      turns: 1,
      commit_shas: [],
    }),
  );
}

describe('memory_propose transport (A3 accept)', () => {
  it('appends a C2 candidate_proposed event onto teambrain/sessions', async () => {
    const runtimeDir = await tempRuntimeDir(cleanups);
    const repo = await tempRepo();
    const spool = new Spool({ runtimeDir, brainDir: repo, push: false });
    const sid = '01J9ZAGENTPROPOSE0000000000';

    await spool.handle(envelope(sid, 'session_start', {}));
    const context = await proposeIntoSpool(sid, spool, runtimeDir);
    createTools(context).memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
      },
    });
    await sessionEnd(spool, sid);

    const stored = git(
      ['show', `${SESSIONS_BRANCH}:sessions/${sid}.jsonl`],
      repo,
    );
    const events = stored
      .trim()
      .split('\n')
      .map((line) => parseSessionEventLine(line)); // (a) validates against C2
    const proposed = events.find((e) => e.ev === 'candidate_proposed');
    expect(proposed).toBeDefined();
    const draft = (proposed!.data as { draft: CandidateDraft & { evidence?: { sessions: string[] } } }).draft;
    expect(draft.title).toBe('Prefer WAL mode for concurrent readers');
    // (c) carries the auto-evidence the agent proposal was stamped with.
    expect(draft.evidence?.sessions).toEqual([sid]);
  });

  it('redacts corpus secrets before they reach the sessions branch', async () => {
    const runtimeDir = await tempRuntimeDir(cleanups);
    const repo = await tempRepo();
    const spool = new Spool({ runtimeDir, brainDir: repo, push: false });
    const sid = '01J9ZAGENTREDACT00000000000';
    const secrets = loadRedactionCorpus()
      .filter((c) => c.kind === 'positive' && c.secret !== undefined)
      .map((c) => ({ input: c.input, secret: c.secret as string }));
    expect(secrets.length).toBeGreaterThan(0);

    await spool.handle(envelope(sid, 'session_start', {}));
    const context = await proposeIntoSpool(sid, spool, runtimeDir);
    const tools = createTools(context);
    for (const [i, { input }] of secrets.entries()) {
      tools.memoryPropose({
        draft: {
          class: 'learning',
          title: `Rotate leaked credential ${i}`,
          body: `Seen in a config, rotate and never commit it:\n${input}\n`,
        },
      });
    }
    await sessionEnd(spool, sid);

    const stored = git(
      ['show', `${SESSIONS_BRANCH}:sessions/${sid}.jsonl`],
      repo,
    );
    // (b) zero un-redacted corpus secrets survive into the committed record.
    for (const { secret } of secrets) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).toContain('«REDACTED:');
  });
});
