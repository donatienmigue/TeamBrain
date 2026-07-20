import type { SessionEvent } from '@teambrain/core';
import {
  computePracticeSignals,
  isContextInjection,
  type PracticeSignals,
} from './practice-signals.js';
import {
  computeContextMetrics,
  type ContextMetrics,
} from './context-metrics.js';

// M7.1 digest aggregation. "Aggregate-only by construction" (Tech Brief §4.7):
// the aggregator never sees anything that could group activity by a person. It
// operates exclusively on AggregateEvent — a projection that keeps only the
// event kind and its data payload and drops the C2 join keys (sid, tool, model,
// repo, branch) and any future author/user field. Nothing here can attribute
// activity to an individual, so the digest output is people-free by structure,
// not by discipline.

/**
 * The only event shape the aggregator is allowed to touch. Deliberately missing
 * every identity-bearing field. `toAggregateEvent` is the sole way in.
 */
export interface AggregateEvent {
  ev: SessionEvent['ev'];
  data: unknown;
}

/** Projects a full event down to the people-free aggregate view. */
export function toAggregateEvent(event: SessionEvent): AggregateEvent {
  return { ev: event.ev, data: event.data };
}

/** An active memory, as the digest needs it (no author — memories have none). */
export interface DigestMemory {
  id: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  created: string;
}

/** A tool-local rules file and its current hash, vs the brain's baseline. */
export interface RulesFile {
  file: string;
  hash: string;
  /** Baseline hash from the brain, or null when none is recorded yet. */
  baselineHash: string | null;
}

export interface DigestInput {
  /** Session events in the digest window (projected internally). */
  events: SessionEvent[];
  /** Active (merged) memories. */
  active: DigestMemory[];
  /** Retired memory count. */
  retiredCount: number;
  /** Open proposal PRs awaiting review. */
  proposedCount: number;
  /** Tool-local rules files + baselines for the drift check. */
  rules: RulesFile[];
  now?: Date;
  /** Top-N most-retrieved memories to list. Default 5. */
  topN?: number;
  /** No-retrieval staleness threshold in days. Default 90. */
  staleDays?: number;
  /** Required-memory token budget for the rot flag (§3.1). */
  requiredBudget?: number;
}

export interface DigestReport {
  memories: { proposed: number; approved: number; retired: number };
  /** Most-retrieved memory ids in the window, descending. */
  topRetrieved: Array<{ id: string; retrievals: number }>;
  /** Number of retrievals that returned nothing (documentation gaps). */
  noHitSearches: number;
  /** Active memories ≥ staleDays old with no retrieval in the window. */
  stale: Array<{ id: string; title: string; created: string }>;
  /** Rules-file drift vs the brain baseline. */
  drift: Array<{ file: string; hash: string; changed: boolean }>;
  /**
   * D3 practice signals. Computed by practice-signals.ts, which reads sids to
   * group events into sessions but emits only counts/distributions — the
   * people-free-output guarantee is its negative test, not this projection.
   */
  practice: PracticeSignals;
  /**
   * Performance-metrics brief §3.1: context-efficiency & rot metrics —
   * injection weight/utilization, required-load, served staleness. People-free
   * (computed by context-metrics.ts from injection + tool_use events).
   */
  contextMetrics: ContextMetrics;
  /** §3.3 composite: avoided exploration vs injected weight (the whole thesis). */
  netEfficiency: NetEfficiency;
  /**
   * D3.1 governance friction: how long memory-proposal PRs wait for a human.
   * Populated by the digest command (source: `gh pr list`, injectable);
   * absent when the query is unavailable (no gh / no remote).
   */
  governance?: GovernanceFriction;
}

/**
 * §3.3 the one composite that answers the question: avoided exploration
 * (from the CodeMap holdout — treatment vs randomized control, NOT a
 * self-selecting before/after) versus the injection weight it costs. Reported
 * with the same measured/estimated + CI labeling as the holdout.
 */
export interface NetEfficiency {
  /** Treatment-vs-control exploration reduction % (from the holdout arms). */
  explorationReductionPct: number | null;
  reductionCi95: [number, number] | null;
  label: 'measured' | 'estimated';
  controlSessions: number;
  treatmentSessions: number;
  /** Median tokens injected per session — the cost side of the ratio. */
  injectionWeightTokens: number;
  /**
   * The honest verdict. `insufficient-data` until the holdout is `measured`;
   * `net-anti-rot` only when the reduction is real (CI excludes zero) and
   * clears the ≥30% CM6 bar; `net-rot` when treatment explored MORE; else
   * `inconclusive` (collect more sessions, don't ship).
   */
  verdict: 'net-anti-rot' | 'inconclusive' | 'net-rot' | 'insufficient-data';
}

export interface GovernanceFriction {
  /** Merged `teambrain/proposals-*` PRs found (last 100). */
  mergedProposalPRs: number;
  /** Median hours from PR creation to merge, null when none merged yet. */
  medianHoursToMerge: number | null;
}

function retrievedIds(event: AggregateEvent): string[] {
  if (event.ev !== 'memory_retrieved') return [];
  const ids = (event.data as { ids?: unknown }).ids;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : [];
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

/** The CM6 exploration-reduction bar the composite calls a win (§3.5). */
export const NET_EFFICIENCY_TARGET_PCT = 30;

function computeNetEfficiency(
  practice: PracticeSignals,
  contextMetrics: ContextMetrics,
): NetEfficiency {
  const h = practice.codemapHoldout;
  const ci = h.reductionCi95;
  const verdict: NetEfficiency['verdict'] =
    h.label !== 'measured' || h.reductionPct === null || ci === null
      ? 'insufficient-data'
      : ci[1] < 0
        ? 'net-rot' // treatment explored more; the whole CI is negative
        : ci[0] > 0 && h.reductionPct >= NET_EFFICIENCY_TARGET_PCT
          ? 'net-anti-rot'
          : 'inconclusive';
  return {
    explorationReductionPct: h.reductionPct,
    reductionCi95: ci,
    label: h.label,
    controlSessions: h.control.sessions,
    treatmentSessions: h.treatment.sessions,
    injectionWeightTokens: contextMetrics.injectionWeight.median,
    verdict,
  };
}

/** Computes the weekly digest from people-free inputs. Pure + deterministic. */
export function aggregateDigest(input: DigestInput): DigestReport {
  const now = input.now ?? new Date();
  const topN = input.topN ?? 5;
  const staleDays = input.staleDays ?? 90;

  // Project every event before touching it — the aggregator only ever sees the
  // people-free view.
  const events = input.events.map(toAggregateEvent);

  const retrievalCounts = new Map<string, number>();
  let noHitSearches = 0;
  for (const event of events) {
    if (event.ev !== 'memory_retrieved') continue;
    // Injections (via:'context') are not queries — the context-efficiency
    // metrics read them; topRetrieved/no-hit/staleness stay query-only.
    if (isContextInjection(event.data)) continue;
    const ids = retrievedIds(event);
    if (ids.length === 0) {
      noHitSearches += 1;
      continue;
    }
    for (const id of ids) {
      retrievalCounts.set(id, (retrievalCounts.get(id) ?? 0) + 1);
    }
  }

  const topRetrieved = [...retrievalCounts.entries()]
    .map(([id, retrievals]) => ({ id, retrievals }))
    .sort((a, b) => b.retrievals - a.retrievals || a.id.localeCompare(b.id))
    .slice(0, topN);

  const stale = input.active
    .filter((memory) => {
      const created = new Date(`${memory.created}T00:00:00Z`);
      const oldEnough =
        !Number.isNaN(created.getTime()) &&
        daysBetween(created, now) >= staleDays;
      return oldEnough && !retrievalCounts.has(memory.id);
    })
    .map((memory) => ({
      id: memory.id,
      title: memory.title,
      created: memory.created,
    }))
    .sort(
      (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
    );

  const drift = input.rules
    .map((rule) => ({
      file: rule.file,
      hash: rule.hash,
      changed: rule.baselineHash !== null && rule.baselineHash !== rule.hash,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const practice = computePracticeSignals(input.events);
  const contextMetrics = computeContextMetrics(input.events, {
    active: input.active,
    staleDays,
    now,
    ...(input.requiredBudget === undefined
      ? {}
      : { requiredBudget: input.requiredBudget }),
  });

  return {
    memories: {
      proposed: input.proposedCount,
      approved: input.active.length,
      retired: input.retiredCount,
    },
    topRetrieved,
    noHitSearches,
    stale,
    drift,
    practice,
    contextMetrics,
    netEfficiency: computeNetEfficiency(practice, contextMetrics),
  };
}
