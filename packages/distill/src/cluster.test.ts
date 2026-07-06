import { describe, expect, it } from 'vitest';
import { clusterSignals } from './cluster.js';
import type { PullRequest } from './types.js';
import {
  command,
  edit,
  event,
  noHit,
  proposed,
  record,
} from './test-helpers.js';

describe('clusterSignals — path struggles', () => {
  it('clusters a path edited across ≥2 sessions, not one edited in a single session', () => {
    const records = [
      record('s1', [edit('s1', 'src/a.ts'), edit('s1', 'src/b.ts')], ['c1']),
      record('s2', [edit('s2', 'src/a.ts')], ['c2']),
    ];
    const clusters = clusterSignals(records);
    const paths = clusters.filter((c) => c.kind === 'path_struggle');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.key).toBe('src/a.ts');
    expect(paths[0]?.sessions).toEqual(['s1', 's2']);
    expect(paths[0]?.commits).toEqual(['c1', 'c2']);
    expect(paths[0]?.strength).toBe(2);
    expect(paths[0]?.detail).toMatchObject({ path: 'src/a.ts', edit_count: 2 });
  });

  it('links merged PRs that touched the path into commit evidence', () => {
    const records = [
      record('s1', [edit('s1', 'src/a.ts')], ['c1']),
      record('s2', [edit('s2', 'src/a.ts')], []),
    ];
    const prs: PullRequest[] = [
      { number: 7, title: 'Fix a', files: ['src/a.ts'], commits: ['pr7c'] },
      { number: 9, title: 'Other', files: ['src/z.ts'], commits: ['pr9c'] },
    ];
    const [cluster] = clusterSignals(records, prs);
    expect(cluster?.commits).toEqual(['c1', 'pr7c']);
    expect(cluster?.detail['prs']).toEqual([7]);
  });
});

describe('clusterSignals — failing commands', () => {
  it('clusters repeated non-zero exits by kind, ignoring successes', () => {
    const records = [
      record('s1', [command('s1', 1, 'test'), command('s1', 0, 'test')]),
      record('s2', [command('s2', 2, 'test')]),
    ];
    const [cluster] = clusterSignals(records);
    expect(cluster?.kind).toBe('failing_command');
    expect(cluster?.key).toBe('test');
    expect(cluster?.strength).toBe(2);
    expect(cluster?.detail).toMatchObject({
      command_kind: 'test',
      exit_codes: [1, 2],
    });
  });

  it('does not cluster a single failure below the threshold', () => {
    const records = [record('s1', [command('s1', 1, 'command')])];
    expect(clusterSignals(records)).toHaveLength(0);
  });
});

describe('clusterSignals — no-hit searches', () => {
  it('clusters repeated empty retrievals', () => {
    const records = [record('s1', [noHit('s1')]), record('s2', [noHit('s2')])];
    const [cluster] = clusterSignals(records);
    expect(cluster?.kind).toBe('no_hit_search');
    expect(cluster?.strength).toBe(2);
    expect(cluster?.detail).toEqual({ no_hit_count: 2 });
  });

  it('ignores retrievals that returned ids', () => {
    const records = [
      record('s1', [event('s1', 'memory_retrieved', { ids: ['m1'] })]),
      record('s2', [event('s2', 'memory_retrieved', { ids: ['m2'] })]),
    ];
    expect(clusterSignals(records)).toHaveLength(0);
  });
});

describe('clusterSignals — agent candidates', () => {
  it('merges identical proposed titles across sessions', () => {
    const records = [
      record('s1', [proposed('s1', 'Use WAL mode')], ['c1']),
      record('s2', [proposed('s2', 'use wal mode')], ['c2']),
      record('s3', [proposed('s3', 'Pin the model')]),
    ];
    const candidates = clusterSignals(records).filter(
      (c) => c.kind === 'agent_candidate',
    );
    expect(candidates).toHaveLength(2);
    const wal = candidates.find((c) => c.key === 'use wal mode');
    expect(wal?.strength).toBe(2);
    expect(wal?.sessions).toEqual(['s1', 's2']);
    expect(wal?.commits).toEqual(['c1', 'c2']);
    expect((wal?.detail['draft'] as { title: string }).title).toBe(
      'Use WAL mode',
    );
  });
});

describe('clusterSignals — determinism', () => {
  it('sorts by kind then key regardless of input order', () => {
    const records = [
      record('s1', [proposed('s1', 'Zeta'), edit('s1', 'src/a.ts')], ['c1']),
      record('s2', [
        edit('s2', 'src/a.ts'),
        command('s2', 1),
        command('s2', 1),
      ]),
    ];
    const kinds = clusterSignals(records).map((c) => c.kind);
    expect(kinds).toEqual([
      'path_struggle',
      'failing_command',
      'agent_candidate',
    ]);
  });
});
