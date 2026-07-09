import { describe, expect, it } from 'vitest';
import { extractProposedTitles, deriveFlywheelExamples } from './flywheel.js';
import type { ExistingMemory } from './brain-memories.js';

describe('extractProposedTitles', () => {
  it('extracts titles from a PR body table', () => {
    const body = `## TeamBrain distiller
Some intro text

| Class | Title | Evidence | Novelty | Score | Supersedes |
| --- | --- | ---: | ---: | ---: | --- |
| decision | Run migrations with \`--squash\` | 2 | 1.00 | 2.00 | — |
| convention | Require PR reviews | 3 | 0.90 | 2.70 | — |

Some outro text`;
    const titles = extractProposedTitles(body);
    expect(titles).toEqual([
      'Run migrations with `--squash`',
      'Require PR reviews',
    ]);
  });

  it('handles escaped pipes in the title', () => {
    const body = `| Class | Title |
| --- | --- |
| learning | Use foo\\|bar syntax |`;
    const titles = extractProposedTitles(body);
    expect(titles).toEqual(['Use foo|bar syntax']);
  });
});

describe('deriveFlywheelExamples', () => {
  it('identifies accepted (from existing) and rejected (from PR bodies)', () => {
    const existing: ExistingMemory[] = [
      { id: '1', title: 'Accepted memory 1' } as ExistingMemory,
      { id: '2', title: 'Accepted memory 2' } as ExistingMemory,
    ];

    const prBodies = [
      `| Class | Title |
| --- | --- |
| class | Rejected memory 1 |
| class | Accepted memory 1 |`, // Accepted memory 1 was merged!
      `| Class | Title |
| --- | --- |
| class | Rejected memory 2 |`,
    ];

    const examples = deriveFlywheelExamples(prBodies, existing);
    expect(examples.accepted).toEqual([
      'Accepted memory 1',
      'Accepted memory 2',
    ]);
    // Rejected memories are the ones in PRs that don't appear in existing.
    expect(examples.rejected).toEqual([
      'Rejected memory 1',
      'Rejected memory 2',
    ]);
  });
});
