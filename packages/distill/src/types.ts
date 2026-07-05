import type { SessionEvent } from '@teambrain/core';

// M6.1 shared types for the collect + cluster stage. Everything here is
// metadata only — the session records the distiller reads were redacted at
// capture time (M5), so no raw content is present to leak into a candidate.

/** One session's redacted event stream, read from `teambrain/sessions`. */
export interface SessionRecord {
  sid: string;
  events: SessionEvent[];
  /** Commit SHAs from the session's session_end event (C2 evidence). */
  commitShas: string[];
  repo?: string;
  branch?: string;
}

/** Merged pull-request metadata (from `gh pr list --json`; GitLab deferred). */
export interface PullRequest {
  number: number;
  title: string;
  /** Repo-relative paths the PR touched. */
  files: string[];
  /** Commit SHAs on the PR. */
  commits: string[];
  mergedAt?: string;
}

export type ClusterKind =
  'path_struggle' | 'failing_command' | 'no_hit_search' | 'agent_candidate';

/**
 * A clustered signal: the evidence bundle M6.2 will draft one candidate
 * memory from. `sessions`/`commits` map directly to C1 `evidence`.
 */
export interface Cluster {
  kind: ClusterKind;
  /** Grouping key (a path, a command kind, a normalized title, …). */
  key: string;
  /** Distinct session ids that contributed, sorted. */
  sessions: string[];
  /** Distinct commit SHAs (session_end + linked PRs), sorted. */
  commits: string[];
  /** Signal strength — the number of contributing occurrences. */
  strength: number;
  /** Kind-specific detail (path + edit_count, the proposed draft, …). */
  detail: Record<string, unknown>;
}

/** Tunable clustering thresholds (M6.1 defaults match the BUILD_PLAN). */
export interface ClusterOptions {
  /** A path must recur across this many distinct sessions to cluster. */
  minPathSessions: number;
  /** Minimum failing-command occurrences to cluster. */
  minFailures: number;
  /** Minimum no-hit search occurrences to cluster. */
  minNoHits: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  minPathSessions: 2,
  minFailures: 2,
  minNoHits: 2,
};
