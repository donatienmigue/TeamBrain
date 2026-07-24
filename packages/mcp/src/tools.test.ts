import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isUlid,
  sessionEventSchema,
  type CandidateDraft,
} from '@teambrain/core';
import { createTools } from './tools.js';
import {
  FIXTURE_IDS,
  fixtureBrainDir,
  indexForBrain,
  tempRuntimeDir,
  toolContextFor,
} from './test-helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/** Reads the one spooled candidate record for `candidateId`. */
function readSpooledDraft(
  runtimeDir: string,
  candidateId: string,
): { draft: { evidence?: { sessions: string[]; commits: string[] } } } {
  const path = join(runtimeDir, 'spool', 'candidates', `${candidateId}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function tools() {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  const runtimeDir = await tempRuntimeDir(cleanups);
  const context = toolContextFor(index, runtimeDir);
  return { tools: createTools(context), context, runtimeDir };
}

describe('memory_search', () => {
  it('returns ranked C3 memory views for a query', async () => {
    const { tools: t } = await tools();
    const results = await t.memorySearch({ query: 'zod validation boundary' });
    expect(results[0]?.id).toBe(FIXTURE_IDS.requiredZod);
    expect(results[0]?.provenance).toContain('conventions/');
    expect(results[0]?.class).toBe('convention');
  });

  it('honors k', async () => {
    const { tools: t } = await tools();
    const results = await t.memorySearch({
      query: 'daemon index search',
      k: 1,
    });
    expect(results).toHaveLength(1);
  });
});

describe('memory_context', () => {
  it('returns required-first within budget', async () => {
    const { tools: t } = await tools();
    const context = t.memoryContext();
    expect(context.required.map((memory) => memory.id)).toEqual([
      FIXTURE_IDS.requiredZod,
    ]);
    expect(context.token_estimate).toBeLessThanOrEqual(2000);
  });
});

describe('memory_propose', () => {
  it('spools a candidate and returns its id (nothing touches the brain)', async () => {
    const { tools: t, runtimeDir } = await tools();
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
      },
    });
    expect(result.queued).toBe(true);
    expect(isUlid(result.candidate_id)).toBe(true);
    const spoolDir = join(runtimeDir, 'spool', 'candidates');
    const files = readdirSync(spoolDir);
    expect(files).toEqual([`${result.candidate_id}.json`]);
    const record = JSON.parse(
      readFileSync(join(spoolDir, files[0] as string), 'utf8'),
    );
    expect(record.draft.title).toBe('Prefer WAL mode for concurrent readers');
  });

  it('stamps the resolved session evidence when the draft carries none (A2)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    const context = toolContextFor(index, runtimeDir);
    context.resolveEvidence = () => ({
      sessions: ['01J9ZSESSION00000000000000'],
      commits: [],
    });
    const t = createTools(context);
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
      },
    });
    expect(result.queued).toBe(true);
    const record = readSpooledDraft(runtimeDir, result.candidate_id);
    expect(record.draft.evidence).toEqual({
      sessions: ['01J9ZSESSION00000000000000'],
      commits: [],
    });
  });

  it('omits evidence when no session resolves, mirroring tb propose (A2)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    const context = toolContextFor(index, runtimeDir);
    context.resolveEvidence = () => undefined; // no active session
    const t = createTools(context);
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
      },
    });
    expect(result.queued).toBe(true);
    const record = readSpooledDraft(runtimeDir, result.candidate_id);
    expect(record.draft.evidence).toBeUndefined();
  });

  it('does not overwrite evidence the agent supplied explicitly (A2)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    const context = toolContextFor(index, runtimeDir);
    context.resolveEvidence = () => ({ sessions: ['resolved'], commits: [] });
    const t = createTools(context);
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Prefer WAL mode for concurrent readers',
        body: 'SQLite WAL lets the daemon write while readers query.',
        evidence: { sessions: ['caller-supplied'], commits: ['abc123'] },
      },
    });
    const record = readSpooledDraft(runtimeDir, result.candidate_id);
    expect(record.draft.evidence.sessions).toEqual(['caller-supplied']);
  });

  it('redacts secrets in the draft before it is spooled (A3)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    const t = createTools(toolContextFor(index, runtimeDir));
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Rotate the AKIAIOSFODNN7EXAMPLE key',
        body: 'The daemon read AKIAIOSFODNN7EXAMPLE from the env; rotate it.',
      },
    });
    const record = readSpooledDraft(runtimeDir, result.candidate_id) as {
      draft: { title: string; body: string };
    };
    expect(JSON.stringify(record)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(record.draft.title).toContain('«REDACTED:aws_access_key»');
    expect(record.draft.body).toContain('«REDACTED:aws_access_key»');
  });

  it('emits the redacted, evidence-stamped draft as a C2 event (A3)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    const context = toolContextFor(index, runtimeDir);
    context.resolveEvidence = () => ({
      sessions: ['01J9ZSESSION00000000000000'],
      commits: [],
    });
    const emitted: CandidateDraft[] = [];
    context.emitCandidateProposed = (draft) => emitted.push(draft);
    const t = createTools(context);
    t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Rotate the leaked key',
        body: 'Rotate AKIAIOSFODNN7EXAMPLE immediately.',
      },
    });
    expect(emitted).toHaveLength(1);
    const draft = emitted[0] as CandidateDraft & {
      evidence: { sessions: string[] };
    };
    // Redacted before it left the tool…
    expect(JSON.stringify(draft)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    // …carrying the resolved session evidence…
    expect(draft.evidence.sessions).toEqual(['01J9ZSESSION00000000000000']);
    // …and it wraps into a C2-valid candidate_proposed event.
    const event = sessionEventSchema.parse({
      v: 1,
      sid: '01J9ZSESSION00000000000000',
      t: '2026-07-24T00:00:00.000Z',
      tool: 'claude-code',
      model: 'm',
      repo: 'acme/api',
      branch: 'main',
      ev: 'candidate_proposed',
      data: { draft },
    });
    expect(event.ev).toBe('candidate_proposed');
  });

  it('does not emit when no emitter is wired; still spools locally (A3)', async () => {
    const index = await indexForBrain(fixtureBrainDir());
    cleanups.push(() => index.close());
    const runtimeDir = await tempRuntimeDir(cleanups);
    // No emitCandidateProposed (e.g. daemon-less / degraded) → local spool only.
    const t = createTools(toolContextFor(index, runtimeDir));
    const result = t.memoryPropose({
      draft: {
        class: 'learning',
        title: 'Local only',
        body: 'This still lands in the local spool.',
      },
    });
    expect(result.queued).toBe(true);
    expect(readdirSync(join(runtimeDir, 'spool', 'candidates'))).toContain(
      `${result.candidate_id}.json`,
    );
  });

  it('rejects a draft that fails schema validation', async () => {
    const { tools: t } = await tools();
    expect(() =>
      t.memoryPropose({
        // @ts-expect-error deliberately invalid class at the boundary
        draft: { class: 'not-a-class', title: 'x', body: 'y' },
      }),
    ).toThrow();
  });
});

describe('memory_feedback', () => {
  it('appends a feedback signal and returns ok', async () => {
    const { tools: t, runtimeDir } = await tools();
    expect(
      t.memoryFeedback({ id: FIXTURE_IDS.mapDaemon, useful: true }),
    ).toEqual({ ok: true });
    const line = readFileSync(
      join(runtimeDir, 'spool', 'feedback.jsonl'),
      'utf8',
    ).trim();
    expect(JSON.parse(line)).toMatchObject({
      id: FIXTURE_IDS.mapDaemon,
      useful: true,
    });
  });
});
