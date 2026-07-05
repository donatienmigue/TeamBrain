import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ulid, type CandidateDraft } from '@teambrain/core';

// memory_propose / memory_feedback local spool (C3: "writes candidate to
// local spool only"). Nothing here touches the brain repo — human-approved
// writes only (principle 4). The distiller (M6) is what later reads this
// spool and opens PRs; here we just durably queue the intent.

export interface QueuedCandidate {
  queued: true;
  candidate_id: string;
}

/**
 * Persists a proposed candidate to `<spoolDir>/<id>.json`. The id is a ULID
 * so the spool sorts chronologically. Caller is expected to have validated
 * `draft` with candidateDraftSchema already; we re-serialize as-is.
 */
export function writeCandidate(
  spoolDir: string,
  draft: CandidateDraft,
  now: Date = new Date(),
): string {
  const candidateId = ulid(now.getTime());
  mkdirSync(spoolDir, { recursive: true });
  const record = {
    v: 1 as const,
    candidate_id: candidateId,
    t: now.toISOString(),
    draft,
  };
  writeFileSync(
    join(spoolDir, `${candidateId}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  return candidateId;
}

/** Appends a useful/not-useful signal for memory `id` to the feedback log. */
export function recordFeedback(
  feedbackPath: string,
  id: string,
  useful: boolean,
  now: Date = new Date(),
): void {
  mkdirSync(dirname(feedbackPath), { recursive: true });
  const line = JSON.stringify({ v: 1, t: now.toISOString(), id, useful });
  appendFileSync(feedbackPath, `${line}\n`, 'utf8');
}
