import { describe, expect, it } from 'vitest';
import { ghPullRequestSource, type ExecFn } from './prs.js';

const GH_OUTPUT = JSON.stringify([
  {
    number: 12,
    title: 'Add retry to webhook worker',
    files: [{ path: 'src/jobs/webhook.ts' }, { path: 'src/jobs/retry.ts' }],
    commits: [{ oid: 'abc123' }, { oid: 'def456' }],
    mergedAt: '2026-07-01T10:00:00Z',
  },
  { number: 13, title: 'Docs', files: [], commits: [] },
]);

describe('ghPullRequestSource', () => {
  it('parses gh pr list JSON into PullRequest records', () => {
    const exec: ExecFn = () => GH_OUTPUT;
    const prs = ghPullRequestSource('/repo', { exec }).readMergedPRs();
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({
      number: 12,
      title: 'Add retry to webhook worker',
      files: ['src/jobs/webhook.ts', 'src/jobs/retry.ts'],
      commits: ['abc123', 'def456'],
      mergedAt: '2026-07-01T10:00:00Z',
    });
    expect(prs[1]?.files).toEqual([]);
  });

  it('requests only merged PRs with the needed fields', () => {
    let seen: string[] = [];
    const exec: ExecFn = (_command, args) => {
      seen = args;
      return '[]';
    };
    ghPullRequestSource('/repo', { exec }).readMergedPRs();
    expect(seen).toContain('merged');
    expect(seen).toContain('number,title,files,commits,mergedAt');
  });

  it('degrades to an empty list when gh fails', () => {
    const exec: ExecFn = () => {
      throw new Error('gh: not found');
    };
    expect(ghPullRequestSource('/repo', { exec }).readMergedPRs()).toEqual([]);
  });

  it('degrades to an empty list on non-JSON output', () => {
    const exec: ExecFn = () => 'not json';
    expect(ghPullRequestSource('/repo', { exec }).readMergedPRs()).toEqual([]);
  });
});
