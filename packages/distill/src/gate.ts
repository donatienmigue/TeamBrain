import { memoryPath, type Memory } from '@teambrain/core';
import type { DedupedCandidate, ConflictFlag } from './dedup.js';

// M6.4 gate: score each surviving candidate, keep the top N, and render the PR
// body. Score = evidence_count × novelty(1 − max_sim) (BUILD_PLAN M6.4), so a
// candidate is ranked up by how much it's cited and how new it is.

export const DEFAULT_MAX_PROPOSALS = 10;

export interface Proposal {
  memory: Memory;
  /** Repo-relative path the memory file will be written to. */
  path: string;
  /** sessions + commits count from the memory's evidence block. */
  evidenceCount: number;
  novelty: number;
  score: number;
  /** Present when this proposal supersedes an existing memory. */
  conflict?: ConflictFlag;
}

function evidenceCount(memory: Memory): number {
  const evidence = memory.evidence;
  if (evidence === undefined) return 0;
  return evidence.sessions.length + evidence.commits.length;
}

/**
 * Scores and ranks candidates, returning the top `max`. Deterministic:
 * sorted by score desc, then title, then id, so ties are stable.
 */
export function gateCandidates(
  candidates: DedupedCandidate[],
  max: number = DEFAULT_MAX_PROPOSALS,
): Proposal[] {
  const proposals: Proposal[] = candidates.map((candidate) => {
    const count = evidenceCount(candidate.memory);
    const score = count * candidate.novelty;
    return {
      memory: candidate.memory,
      path: memoryPath(candidate.memory),
      evidenceCount: count,
      novelty: candidate.novelty,
      score,
      ...(candidate.conflict === undefined
        ? {}
        : { conflict: candidate.conflict }),
    };
  });

  proposals.sort(
    (a, b) =>
      b.score - a.score ||
      a.memory.title.localeCompare(b.memory.title) ||
      a.memory.id.localeCompare(b.memory.id),
  );

  return proposals.slice(0, max);
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/**
 * Renders the PR body, designed for a <60s-per-candidate review (D3.1):
 * a one-line verdict row per candidate (the summary table — its
 * `| Class | Title |` header is parsed by flywheel.ts, keep it stable),
 * a collapsible full-body block per candidate so the reviewer only expands
 * what the verdict row doesn't settle, and copy-paste partial-accept
 * commands so dropping a candidate never blocks the rest of the batch.
 */
export function renderPrBody(proposals: Proposal[]): string {
  if (proposals.length === 0) {
    return 'No memory candidates survived scoring for this run.\n';
  }

  const lines: string[] = [
    `## TeamBrain distiller — ${proposals.length} proposed ` +
      `${proposals.length === 1 ? 'memory' : 'memories'}`,
    '',
    'One row per candidate: merge what reads true, drop the rest with the ' +
      'commands below. Every file passes `tb lint --require-evidence`.',
    '',
    '| Class | Title | Evidence | Novelty | Score | Supersedes |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];

  for (const proposal of proposals) {
    lines.push(
      `| ${proposal.memory.class} | ${escapeCell(proposal.memory.title)} | ` +
        `${proposal.evidenceCount} | ${proposal.novelty.toFixed(2)} | ` +
        `${proposal.score.toFixed(2)} | ` +
        `${proposal.conflict?.supersedesId ?? '—'} |`,
    );
  }

  lines.push('', '### Candidate detail', '');
  for (const proposal of proposals) {
    const evidence = proposal.memory.evidence;
    const evidenceLine =
      evidence === undefined
        ? 'none recorded'
        : `${evidence.sessions.length} session(s) · ` +
          `${evidence.commits.length} commit(s)` +
          (evidence.commits.length > 0
            ? ` (${evidence.commits.map((c) => `\`${c}\``).join(', ')})`
            : '');
    lines.push(
      '<details>',
      `<summary><b>${escapeCell(proposal.memory.title)}</b> — ` +
        `${proposal.memory.class}` +
        (proposal.conflict === undefined ? '' : ' · ⚠ supersedes') +
        '</summary>',
      '',
      `*File:* \`${proposal.path}\` · *Evidence:* ${evidenceLine}`,
      '',
      proposal.memory.body.trim(),
      '',
      '</details>',
      '',
    );
  }

  const conflicts = proposals.filter((p) => p.conflict !== undefined);
  if (conflicts.length > 0) {
    lines.push('### ⚠ Supersedes existing memories', '');
    for (const proposal of conflicts) {
      const reason = proposal.conflict?.reason;
      lines.push(
        `- **${escapeCell(proposal.memory.title)}** supersedes ` +
          `\`${proposal.conflict?.supersedesId}\`` +
          (reason ? ` — ${escapeCell(reason)}` : ''),
      );
    }
    lines.push('');
  }

  lines.push(
    '### Partial accept',
    '',
    'To drop a candidate, delete its file on this branch and push; the rest',
    'merge as-is:',
    '',
    '```sh',
    ...proposals.map((proposal) => `# git rm "${proposal.path}"`),
    'git commit -m "distill: drop declined candidates" && git push',
    '```',
    '',
  );
  return lines.join('\n');
}
