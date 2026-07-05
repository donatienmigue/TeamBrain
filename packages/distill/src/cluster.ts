import type { CandidateDraft, SessionEvent } from '@teambrain/core';
import {
  DEFAULT_CLUSTER_OPTIONS,
  type Cluster,
  type ClusterKind,
  type ClusterOptions,
  type PullRequest,
  type SessionRecord,
} from './types.js';

// M6.1 clustering: turn redacted session records (+ merged-PR metadata) into
// evidence bundles. Four signals per the BUILD_PLAN: same-path struggles
// across ≥2 sessions, repeated failing commands, no-hit memory searches, and
// agent-proposed candidates. Pure and deterministic — the whole thing is a
// fold over events with sorted output, so the golden pipeline test is stable.

interface ToolUse {
  kind: 'edit' | 'command' | 'test';
  path?: string;
  exit_code?: number;
}

function sidToCommits(records: SessionRecord[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const record of records) {
    const existing = map.get(record.sid) ?? [];
    map.set(record.sid, [...existing, ...record.commitShas]);
  }
  return map;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function commitsFor(
  sessions: Iterable<string>,
  bySession: Map<string, string[]>,
  extra: Iterable<string> = [],
): string[] {
  const commits: string[] = [...extra];
  for (const sid of sessions) commits.push(...(bySession.get(sid) ?? []));
  return sortedUnique(commits);
}

function toolUsesOf(record: SessionRecord): ToolUse[] {
  return record.events
    .filter(
      (event): event is SessionEvent & { ev: 'tool_use' } =>
        event.ev === 'tool_use',
    )
    .map((event) => event.data as ToolUse);
}

function pathStruggleClusters(
  records: SessionRecord[],
  prs: PullRequest[],
  options: ClusterOptions,
  bySession: Map<string, string[]>,
): Cluster[] {
  const byPath = new Map<string, { sessions: Set<string>; edits: number }>();
  for (const record of records) {
    for (const use of toolUsesOf(record)) {
      if (use.kind !== 'edit' || use.path === undefined) continue;
      const entry = byPath.get(use.path) ?? { sessions: new Set(), edits: 0 };
      entry.sessions.add(record.sid);
      entry.edits += 1;
      byPath.set(use.path, entry);
    }
  }

  const clusters: Cluster[] = [];
  for (const [path, entry] of byPath) {
    if (entry.sessions.size < options.minPathSessions) continue;
    const linkedPrs = prs.filter((pr) => pr.files.includes(path));
    const clusterDetail: Record<string, unknown> = {
      path,
      edit_count: entry.edits,
    };
    if (linkedPrs.length > 0) {
      clusterDetail['prs'] = linkedPrs
        .map((pr) => pr.number)
        .sort((a, b) => a - b);
    }
    clusters.push({
      kind: 'path_struggle',
      key: path,
      sessions: sortedUnique(entry.sessions),
      commits: commitsFor(
        entry.sessions,
        bySession,
        linkedPrs.flatMap((pr) => pr.commits),
      ),
      strength: entry.edits,
      detail: clusterDetail,
    });
  }
  return clusters;
}

function failingCommandClusters(
  records: SessionRecord[],
  options: ClusterOptions,
  bySession: Map<string, string[]>,
): Cluster[] {
  const byKind = new Map<
    'command' | 'test',
    { sessions: Set<string>; count: number; exitCodes: Set<number> }
  >();
  for (const record of records) {
    for (const use of toolUsesOf(record)) {
      if (use.kind === 'edit') continue;
      if (typeof use.exit_code !== 'number' || use.exit_code === 0) continue;
      const entry = byKind.get(use.kind) ?? {
        sessions: new Set<string>(),
        count: 0,
        exitCodes: new Set<number>(),
      };
      entry.sessions.add(record.sid);
      entry.count += 1;
      entry.exitCodes.add(use.exit_code);
      byKind.set(use.kind, entry);
    }
  }

  const clusters: Cluster[] = [];
  for (const [kind, entry] of byKind) {
    if (entry.count < options.minFailures) continue;
    clusters.push({
      kind: 'failing_command',
      key: kind,
      sessions: sortedUnique(entry.sessions),
      commits: commitsFor(entry.sessions, bySession),
      strength: entry.count,
      detail: {
        command_kind: kind,
        failures: entry.count,
        exit_codes: [...entry.exitCodes].sort((a, b) => a - b),
      },
    });
  }
  return clusters;
}

function noHitClusters(
  records: SessionRecord[],
  options: ClusterOptions,
  bySession: Map<string, string[]>,
): Cluster[] {
  const sessions = new Set<string>();
  let count = 0;
  for (const record of records) {
    for (const event of record.events) {
      if (event.ev !== 'memory_retrieved') continue;
      if ((event.data as { ids: string[] }).ids.length > 0) continue;
      sessions.add(record.sid);
      count += 1;
    }
  }
  if (count < options.minNoHits) return [];
  return [
    {
      kind: 'no_hit_search',
      key: 'no_hit',
      sessions: sortedUnique(sessions),
      commits: commitsFor(sessions, bySession),
      strength: count,
      detail: { no_hit_count: count },
    },
  ];
}

function agentCandidateClusters(
  records: SessionRecord[],
  bySession: Map<string, string[]>,
): Cluster[] {
  const byTitle = new Map<
    string,
    { draft: CandidateDraft; sessions: Set<string>; count: number }
  >();
  for (const record of records) {
    for (const event of record.events) {
      if (event.ev !== 'candidate_proposed') continue;
      const draft = (event.data as { draft: CandidateDraft }).draft;
      const key = draft.title.trim().toLowerCase();
      const entry = byTitle.get(key) ?? {
        draft,
        sessions: new Set<string>(),
        count: 0,
      };
      entry.sessions.add(record.sid);
      entry.count += 1;
      byTitle.set(key, entry);
    }
  }

  const clusters: Cluster[] = [];
  for (const [key, entry] of byTitle) {
    clusters.push({
      kind: 'agent_candidate',
      key,
      sessions: sortedUnique(entry.sessions),
      commits: commitsFor(entry.sessions, bySession),
      strength: entry.count,
      detail: { draft: entry.draft },
    });
  }
  return clusters;
}

const KIND_ORDER: Record<ClusterKind, number> = {
  path_struggle: 0,
  failing_command: 1,
  no_hit_search: 2,
  agent_candidate: 3,
};

/**
 * Clusters the four signal types over the given records and merged PRs.
 * Deterministic: clusters are sorted by kind, then key, then strength desc.
 */
export function clusterSignals(
  records: SessionRecord[],
  prs: PullRequest[] = [],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): Cluster[] {
  const bySession = sidToCommits(records);
  const clusters = [
    ...pathStruggleClusters(records, prs, options, bySession),
    ...failingCommandClusters(records, options, bySession),
    ...noHitClusters(records, options, bySession),
    ...agentCandidateClusters(records, bySession),
  ];
  return clusters.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.key.localeCompare(b.key) ||
      b.strength - a.strength,
  );
}
