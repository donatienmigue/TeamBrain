import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memoryPath,
  serializeMemoryFile,
  type Memory,
  type SessionEvent,
} from '@teambrain/core';
import type { SessionRecord, SessionSource } from '@teambrain/distill';
import { runDigestCommand } from './digest-command.js';
import type { SlackMessage } from './slack.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempBrain(memories: Memory[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-digest-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const brainDir = join(dir, '.teambrain');
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'brain.yaml'), 'version: 1\n', 'utf8');
  for (const memory of memories) {
    const abs = join(brainDir, memoryPath(memory));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeMemoryFile(memory), 'utf8');
  }
  return brainDir;
}

function memory(id: string, title: string, created: string): Memory {
  return {
    id,
    class: 'learning',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title,
    created,
    evidence: { sessions: ['s1'], commits: [] },
    supersedes: [],
    tags: [],
    ttl_days: null,
    body: `Body for ${title}.`,
  };
}

function ev(evName: SessionEvent['ev'], data: object): SessionEvent {
  return {
    v: 1,
    sid: 's1',
    t: '2026-07-01T00:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/web',
    branch: 'main',
    ev: evName,
    data,
  } as SessionEvent;
}

function sessionSource(events: SessionEvent[]): SessionSource {
  const record: SessionRecord = { sid: 's1', events, commitShas: [] };
  return { head: () => 'tip', readNewRecords: () => [record] };
}

const M1 = '01JD01000000000000000000AA';

describe('tb digest (M7.1)', () => {
  it('--dry-run prints the report + Slack payload without posting', async () => {
    const brainDir = tempBrain([memory(M1, 'Cache config', '2026-07-01')]);
    let posted = false;

    const { exitCode, output } = await runDigestCommand('.', {
      dryRun: true,
      brainDir,
      proposedCount: 3,
      sessions: sessionSource([
        ev('memory_retrieved', { ids: [M1] }),
        ev('memory_retrieved', { ids: [] }),
      ]),
      now: new Date('2026-07-06T00:00:00Z'),
      post: () => {
        posted = true;
        return Promise.resolve(true);
      },
    });

    expect(exitCode).toBe(0);
    expect(posted).toBe(false);
    const { report, message } = JSON.parse(
      output.slice(0, output.lastIndexOf('}') + 1),
    );
    expect(report.memories).toEqual({ proposed: 3, approved: 1, retired: 0 });
    expect(report.noHitSearches).toBe(1);
    expect(report.topRetrieved).toEqual([{ id: M1, retrievals: 1 }]);
    expect(message.text).toContain('TeamBrain weekly digest');
  });

  it('posts to the webhook when one is configured', async () => {
    const brainDir = tempBrain([memory(M1, 'Cache config', '2026-07-01')]);
    const calls: Array<{ url: string; message: SlackMessage }> = [];

    const { exitCode, output } = await runDigestCommand('.', {
      brainDir,
      webhookUrl: 'https://hooks.slack.test/abc',
      proposedCount: 0,
      sessions: sessionSource([]),
      now: new Date('2026-07-06T00:00:00Z'),
      post: (url, message) => {
        calls.push({ url, message });
        return Promise.resolve(true);
      },
    });

    expect(exitCode).toBe(0);
    expect(output).toContain('posted the weekly digest');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://hooks.slack.test/abc');
    expect(calls[0]!.message.text).toContain('TeamBrain weekly digest');
  });
});
