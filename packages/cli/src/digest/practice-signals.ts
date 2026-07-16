import type { SessionEvent } from '@teambrain/core';

// D3.2/D3.3 practice signals (POSTV1_PLAN.md). Computes the FlightDeck
// signal-sufficiency aggregates from existing metadata-only events. Privacy
// posture: this module needs `sid` to group events into sessions, so unlike
// aggregate.ts it reads full events — but sessions are not people, grouping
// happens only inside this function, and the output is exclusively counts
// and distribution statistics. No sid, tool, model, repo, branch, path, or
// any other event string ever appears in a PracticeSignals value (asserted
// by a negative test). Definitions live in docs/internal/PRACTICE_SIGNALS.md.

export interface Distribution {
  median: number;
  mean: number;
  max: number;
}

export interface OutcomeCounts {
  committed: number;
  abandoned: number;
  unknown: number;
}

export interface PracticeSignals {
  /** Sessions seen in the window (distinct sids). */
  sessions: number;
  /** Sessions that emitted a session_end. */
  ended: number;
  /** Outcome mix over ended sessions. */
  outcomes: OutcomeCounts;
  /** Per-session retries: a command/test tool_use following a failed one of the same kind. */
  retries: Distribution;
  /** Per-session failed commands (tool_use with exit_code ≠ 0). */
  failedCommands: Distribution;
  /** Per-session plan_revision events. */
  planRevisions: Distribution;
  /** Sessions with ≥1 non-empty memory_retrieved / all sessions (G1 on-ramp proof). */
  retrievalRate: number;
  /**
   * R16.1 T7: sessions that retrieved ≥1 codemap entry (`cm:`-prefixed id) /
   * all sessions — did agents actually query the map? Near-zero after
   * CodeMap ships means the pull model failed (and the answer is better map
   * content, not more pushed tokens).
   */
  codemapQueryRate: number;
  /** Outcome mix split by whether the session retrieved any memory (OQ-7 co-occurrence). */
  outcomesByRetrieval: { retrieved: OutcomeCounts; unretrieved: OutcomeCounts };
  /** Per-session events before the first tool_use — the context-setup proxy (G1). */
  contextSetupEvents: Distribution;
  /** Per-session `explore` tool_use events (Read/Grep/Glob) — the exploration-token proxy (D6/R16). */
  exploration: Distribution;
  /**
   * The D6 acceptance instrument: median exploration events/session split by
   * whether the session retrieved ≥1 codemap entry (`cm:`-prefixed id).
   * `reductionPct` is the relative drop with codemap (null until both arms
   * have sessions); the §4.8 target is ≥30.
   */
  explorationByCodemap: {
    withCodemap: number | null;
    withoutCodemap: number | null;
    reductionPct: number | null;
  };
}

interface SessionFeatures {
  retries: number;
  failedCommands: number;
  planRevisions: number;
  retrieved: boolean;
  retrievedCodemap: boolean;
  exploreEvents: number;
  eventsBeforeFirstToolUse: number;
  outcome: keyof OutcomeCounts | null;
}

function distribution(values: number[]): Distribution {
  if (values.length === 0) return { median: 0, mean: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 1
      ? (sorted[Math.floor(mid)] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    median,
    mean: Math.round(mean * 100) / 100,
    max: sorted[sorted.length - 1] as number,
  };
}

function sessionFeatures(events: SessionEvent[]): SessionFeatures {
  const ordered = [...events].sort((a, b) => a.t.localeCompare(b.t));
  const features: SessionFeatures = {
    retries: 0,
    failedCommands: 0,
    planRevisions: 0,
    retrieved: false,
    retrievedCodemap: false,
    exploreEvents: 0,
    eventsBeforeFirstToolUse: 0,
    outcome: null,
  };
  let lastFailedKind: string | null = null;
  let sawToolUse = false;

  for (const event of ordered) {
    if (event.ev === 'tool_use') {
      sawToolUse = true;
      const kind = event.data.kind;
      const exitCode = (event.data as { exit_code?: unknown }).exit_code;
      const failed = typeof exitCode === 'number' && exitCode !== 0;
      if (kind === 'explore') features.exploreEvents += 1;
      if (kind === 'command' || kind === 'test') {
        if (lastFailedKind === kind) features.retries += 1;
        lastFailedKind = failed ? kind : null;
      }
      if (failed) features.failedCommands += 1;
      continue;
    }
    if (!sawToolUse) features.eventsBeforeFirstToolUse += 1;
    if (event.ev === 'plan_revision') {
      features.planRevisions += 1;
    } else if (event.ev === 'memory_retrieved') {
      const ids = (event.data as { ids?: unknown }).ids;
      if (Array.isArray(ids) && ids.length > 0) {
        features.retrieved = true;
        // Codemap retrievals are identifiable by the cm:<path> id shape —
        // still metadata-only (ids, never bodies).
        if (ids.some((id) => typeof id === 'string' && id.startsWith('cm:'))) {
          features.retrievedCodemap = true;
        }
      }
    } else if (event.ev === 'session_end') {
      features.outcome = event.data.outcome;
    }
  }
  return features;
}

function emptyOutcomes(): OutcomeCounts {
  return { committed: 0, abandoned: 0, unknown: 0 };
}

/**
 * Computes the practice-signal aggregates for the digest window. Pure and
 * deterministic; the only place sids are read, and they do not survive it.
 */
export function computePracticeSignals(
  events: SessionEvent[],
): PracticeSignals {
  const bySid = new Map<string, SessionEvent[]>();
  for (const event of events) {
    const bucket = bySid.get(event.sid);
    if (bucket === undefined) bySid.set(event.sid, [event]);
    else bucket.push(event);
  }

  const sessions = [...bySid.values()].map(sessionFeatures);
  const outcomes = emptyOutcomes();
  const outcomesByRetrieval = {
    retrieved: emptyOutcomes(),
    unretrieved: emptyOutcomes(),
  };
  let ended = 0;
  let retrievedSessions = 0;

  for (const session of sessions) {
    if (session.retrieved) retrievedSessions += 1;
    if (session.outcome === null) continue;
    ended += 1;
    outcomes[session.outcome] += 1;
    outcomesByRetrieval[session.retrieved ? 'retrieved' : 'unretrieved'][
      session.outcome
    ] += 1;
  }

  const withCodemap = sessions.filter((s) => s.retrievedCodemap);
  const withoutCodemap = sessions.filter((s) => !s.retrievedCodemap);
  const medianWith =
    withCodemap.length === 0
      ? null
      : distribution(withCodemap.map((s) => s.exploreEvents)).median;
  const medianWithout =
    withoutCodemap.length === 0
      ? null
      : distribution(withoutCodemap.map((s) => s.exploreEvents)).median;
  const reductionPct =
    medianWith === null || medianWithout === null || medianWithout === 0
      ? null
      : Math.round(((medianWithout - medianWith) / medianWithout) * 100);

  return {
    sessions: sessions.length,
    ended,
    outcomes,
    retries: distribution(sessions.map((s) => s.retries)),
    failedCommands: distribution(sessions.map((s) => s.failedCommands)),
    planRevisions: distribution(sessions.map((s) => s.planRevisions)),
    retrievalRate:
      sessions.length === 0
        ? 0
        : Math.round((retrievedSessions / sessions.length) * 100) / 100,
    codemapQueryRate:
      sessions.length === 0
        ? 0
        : Math.round((withCodemap.length / sessions.length) * 100) / 100,
    outcomesByRetrieval,
    contextSetupEvents: distribution(
      sessions.map((s) => s.eventsBeforeFirstToolUse),
    ),
    exploration: distribution(sessions.map((s) => s.exploreEvents)),
    explorationByCodemap: {
      withCodemap: medianWith,
      withoutCodemap: medianWithout,
      reductionPct,
    },
  };
}
