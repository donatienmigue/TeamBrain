import type { SessionEvent } from '@teambrain/core';
import {
  distribution,
  isContextInjection,
  type Distribution,
} from './practice-signals.js';
import type { DigestMemory } from './aggregate.js';

// Performance-metrics brief §3.1: context-efficiency & rot metrics. Answers
// "is the context TeamBrain injects used, fresh, and worth its budget, or is it
// spending the agent's scarce early-context on noise?" Computed from the
// session-start injection events the daemon logs (memory_retrieved via:'context')
// plus subsequent tool_use paths. People-free by construction: sids are read to
// group events into sessions but only counts/distributions leave this module
// (asserted by the aggregate people-free negative test). No content, ever.

/** Default ceiling on the required-memory token load before it is flagged. */
export const DEFAULT_REQUIRED_TOKEN_BUDGET = 1200;

export interface ContextMetrics {
  /** Sessions that logged a session-start injection in the window. */
  sessionsWithInjection: number;
  /** Tokens injected at session start, per session (memory pool + codemap). */
  injectionWeight: Distribution;
  /**
   * Required-memory load — force-injected into EVERY session. The sharpest rot
   * vector: a bloated required set is a permanent, team-wide context tax.
   * `count`/`tokens` are the worst (max) observed; `overBudget` flags the tax.
   */
  requiredLoad: {
    count: number;
    tokens: number;
    budget: number;
    overBudget: boolean;
  };
  /**
   * Injection utilization (codemap proxy): of the codemap entries injected at
   * session start, the fraction whose source path is later touched by a
   * tool_use in the same session — "was the pushed map actually used?" Low =
   * volume rot. Governed-memory utilization isn't derivable from metadata
   * (memories have no code path), so this is codemap-only and labeled as such.
   */
  utilization: {
    codemapInjected: number;
    codemapReferenced: number;
    rate: number | null;
  };
  /**
   * Served staleness: injected governed memories whose `created` is ≥staleDays
   * old — rot the agent was actually told, not just flagged for review.
   */
  servedStaleness: {
    served: number;
    stale: number;
    rate: number | null;
    staleDays: number;
  };
}

interface Injection {
  ids: string[];
  tokens: number;
  required: number;
  requiredTokens: number;
}

function readInjection(data: unknown): Injection | null {
  if (!isContextInjection(data)) return null;
  const d = data as Record<string, unknown>;
  const ids = Array.isArray(d['ids'])
    ? d['ids'].filter((id): id is string => typeof id === 'string')
    : [];
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    ids,
    tokens: num(d['tokens']),
    required: num(d['required']),
    requiredTokens: num(d['required_tokens']),
  };
}

function toolUsePath(event: SessionEvent): string | null {
  if (event.ev !== 'tool_use') return null;
  const path = (event.data as { path?: unknown }).path;
  return typeof path === 'string' ? path : null;
}

export interface ContextMetricsOptions {
  active: DigestMemory[];
  staleDays: number;
  requiredBudget?: number;
  now?: Date;
}

/**
 * Computes the context-efficiency metrics. Pure and deterministic; groups by
 * sid internally and emits only counts/distributions.
 */
export function computeContextMetrics(
  events: SessionEvent[],
  options: ContextMetricsOptions,
): ContextMetrics {
  const budget = options.requiredBudget ?? DEFAULT_REQUIRED_TOKEN_BUDGET;
  const createdById = new Map(options.active.map((m) => [m.id, m.created]));

  const bySid = new Map<string, SessionEvent[]>();
  for (const event of events) {
    const bucket = bySid.get(event.sid);
    if (bucket === undefined) bySid.set(event.sid, [event]);
    else bucket.push(event);
  }

  const weights: number[] = [];
  let requiredCount = 0;
  let requiredTokens = 0;
  let codemapInjected = 0;
  let codemapReferenced = 0;
  let served = 0;
  let stale = 0;
  const now = options.now ?? new Date();

  for (const bucket of bySid.values()) {
    const ordered = [...bucket].sort((a, b) => a.t.localeCompare(b.t));
    // The first injection in the session is the session-start bundle.
    const injectionEvent = ordered.find(
      (e) => e.ev === 'memory_retrieved' && isContextInjection(e.data),
    );
    const injection =
      injectionEvent === undefined ? null : readInjection(injectionEvent.data);
    if (injection === null) continue;

    weights.push(injection.tokens);
    requiredCount = Math.max(requiredCount, injection.required);
    requiredTokens = Math.max(requiredTokens, injection.requiredTokens);

    // Codemap utilization: paths touched anywhere in the session count as used.
    const touched = new Set(
      ordered.map(toolUsePath).filter((p): p is string => p !== null),
    );
    for (const id of injection.ids) {
      if (id.startsWith('cm:')) {
        codemapInjected += 1;
        if (touched.has(id.slice('cm:'.length))) codemapReferenced += 1;
      } else {
        // Governed memory: served-staleness by created date.
        const created = createdById.get(id);
        if (created === undefined) continue;
        served += 1;
        const createdMs = new Date(`${created}T00:00:00Z`).getTime();
        if (
          !Number.isNaN(createdMs) &&
          (now.getTime() - createdMs) / (1000 * 60 * 60 * 24) >=
            options.staleDays
        ) {
          stale += 1;
        }
      }
    }
  }

  return {
    sessionsWithInjection: weights.length,
    injectionWeight: distribution(weights),
    requiredLoad: {
      count: requiredCount,
      tokens: requiredTokens,
      budget,
      overBudget: requiredTokens > budget,
    },
    utilization: {
      codemapInjected,
      codemapReferenced,
      rate: codemapInjected === 0 ? null : codemapReferenced / codemapInjected,
    },
    servedStaleness: {
      served,
      stale,
      rate: served === 0 ? null : stale / served,
      staleDays: options.staleDays,
    },
  };
}
