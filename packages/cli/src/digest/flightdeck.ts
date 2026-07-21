import type { DigestReport } from './aggregate.js';
import type { OutcomeCounts } from './practice-signals.js';

// E2 FlightDeck v0 (ADR-9): the weekly report as a committed markdown artifact,
// drawn ONLY from PRACTICE_SIGNALS' strong column. Small-cell suppression lives
// HERE, in the report aggregator — not in the renderer — so `--format json`
// cannot emit a raw count that the markdown hides (EVIDENCE_BRIEF §E.2). Nothing
// in this module reads plan_revision (no emitter exists; §E.2). The report is a
// derived artifact and is never indexed.

/** Any aggregate computed over fewer than this many units is suppressed. */
export const SUPPRESSION_THRESHOLD = 5;

/**
 * A value gated by its sample size. A suppressed cell carries only `n` — never
 * the underlying value — so serializing the report cannot leak a small cell.
 */
export type Suppressible<T> =
  { n: number; suppressed: true } | { n: number; suppressed: false; value: T };

function cell<T>(n: number, value: T): Suppressible<T> {
  return n < SUPPRESSION_THRESHOLD
    ? { n, suppressed: true }
    : { n, suppressed: false, value };
}

function outcomeTotal(o: OutcomeCounts): number {
  return o.committed + o.abandoned + o.unknown;
}

export interface FlightDeckReport {
  generatedAt: string;
  window: { sessions: number; ended: number };
  /** Outcome mix over ended sessions. */
  outcomeMix: Suppressible<OutcomeCounts>;
  /** Retry loops + failed commands per session (medians). */
  friction: Suppressible<{
    retriesMedian: number;
    failedCommandsMedian: number;
  }>;
  memory: {
    retrievalRate: Suppressible<number>;
    /** Queries that returned nothing — documented gaps in the brain. */
    noHitSearches: Suppressible<number>;
    /** Outcome mix split by whether the session retrieved a memory. CORRELATION. */
    outcomeByRetrieval: {
      retrieved: Suppressible<OutcomeCounts>;
      unretrieved: Suppressible<OutcomeCounts>;
    };
  };
  governance: Suppressible<{
    mergedProposalPRs: number;
    medianHoursToMerge: number | null;
  }>;
  /** CodeMap holdout exploration reduction (the D6 instrument). */
  exploration: Suppressible<{
    reductionPct: number | null;
    label: 'measured' | 'estimated';
    controlSessions: number;
    treatmentSessions: number;
  }>;
}

/**
 * Projects a DigestReport to the suppressed FlightDeck report. Suppression is a
 * privacy invariant on par with the people-free rule: an aggregate over n<5 is
 * suppressed, never rounded (re-identification risk in small teams).
 */
export function buildFlightDeckReport(
  report: DigestReport,
  options: { generatedAt?: Date } = {},
): FlightDeckReport {
  const p = report.practice;
  const retrievedN = outcomeTotal(p.outcomesByRetrieval.retrieved);
  const unretrievedN = outcomeTotal(p.outcomesByRetrieval.unretrieved);
  const holdout = p.codemapHoldout;
  const armN = Math.min(holdout.control.sessions, holdout.treatment.sessions);

  return {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    window: { sessions: p.sessions, ended: p.ended },
    outcomeMix: cell(p.ended, p.outcomes),
    friction: cell(p.sessions, {
      retriesMedian: p.retries.median,
      failedCommandsMedian: p.failedCommands.median,
    }),
    memory: {
      retrievalRate: cell(p.sessions, p.retrievalRate),
      noHitSearches: cell(p.sessions, report.noHitSearches),
      outcomeByRetrieval: {
        retrieved: cell(retrievedN, p.outcomesByRetrieval.retrieved),
        unretrieved: cell(unretrievedN, p.outcomesByRetrieval.unretrieved),
      },
    },
    governance:
      report.governance === undefined
        ? { n: 0, suppressed: true }
        : cell(report.governance.mergedProposalPRs, report.governance),
    exploration: cell(armN, {
      reductionPct: holdout.reductionPct,
      label: holdout.label,
      controlSessions: holdout.control.sessions,
      treatmentSessions: holdout.treatment.sessions,
    }),
  };
}

// --- markdown renderer ---

const SUPPRESSED = '`n<5` (suppressed)';

function outcomeLine(o: OutcomeCounts): string {
  const total = outcomeTotal(o);
  return `committed ${o.committed} · abandoned ${o.abandoned} · unknown ${o.unknown} (n=${total})`;
}

/**
 * Renders the FlightDeck markdown. Every number carries its `n`; co-occurrence
 * is labelled *correlation*; the header states plainly what this is not.
 */
export function renderFlightDeckMarkdown(fd: FlightDeckReport): string {
  let md = `# TeamBrain FlightDeck — weekly report\n\n`;
  md += `_Generated ${fd.generatedAt}. Team-level, metadata-only, aggregate-by-construction._\n`;
  md += `_This is **not** a productivity metric and **not** per-person; aggregates over `;
  md += `fewer than ${SUPPRESSION_THRESHOLD} units are suppressed, not rounded._\n\n`;
  md += `Window: **${fd.window.sessions}** sessions, **${fd.window.ended}** ended.\n\n`;

  md += `## Outcome mix\n\n`;
  md += fd.outcomeMix.suppressed
    ? `${SUPPRESSED} — ${fd.outcomeMix.n} ended session(s).\n\n`
    : `${outcomeLine(fd.outcomeMix.value)}\n\n`;
  md += `_Cursor sessions report \`unknown\` by construction (no lifecycle hooks — no commit or outcome capture), which inflates \`unknown\`._\n\n`;

  md += `## Friction\n\n`;
  md += fd.friction.suppressed
    ? `${SUPPRESSED} — ${fd.friction.n} session(s).\n\n`
    : `Median retries/session **${fd.friction.value.retriesMedian}**, median failed commands/session **${fd.friction.value.failedCommandsMedian}** (n=${fd.friction.n}).\n\n`;

  md += `## Memory leverage\n\n`;
  md += fd.memory.retrievalRate.suppressed
    ? `- Retrieval rate: ${SUPPRESSED} — ${fd.memory.retrievalRate.n} session(s).\n`
    : `- Retrieval rate: **${Math.round(fd.memory.retrievalRate.value * 100)}%** of sessions retrieved ≥1 memory (n=${fd.memory.retrievalRate.n}).\n`;
  md += fd.memory.noHitSearches.suppressed
    ? `- No-hit searches: ${SUPPRESSED}.\n`
    : `- No-hit searches (documented brain gaps): **${fd.memory.noHitSearches.value}**.\n`;
  md += `\n**Outcome by retrieval** (labelled *correlation*, not causation):\n`;
  md += fd.memory.outcomeByRetrieval.retrieved.suppressed
    ? `- retrieved: ${SUPPRESSED} — n=${fd.memory.outcomeByRetrieval.retrieved.n}.\n`
    : `- retrieved: ${outcomeLine(fd.memory.outcomeByRetrieval.retrieved.value)}.\n`;
  md += fd.memory.outcomeByRetrieval.unretrieved.suppressed
    ? `- unretrieved: ${SUPPRESSED} — n=${fd.memory.outcomeByRetrieval.unretrieved.n}.\n\n`
    : `- unretrieved: ${outcomeLine(fd.memory.outcomeByRetrieval.unretrieved.value)}.\n\n`;

  md += `## Governance friction\n\n`;
  md += fd.governance.suppressed
    ? `${SUPPRESSED} — ${fd.governance.n} merged proposal PR(s).\n\n`
    : `**${fd.governance.value.mergedProposalPRs}** merged proposal PR(s), median ${
        fd.governance.value.medianHoursToMerge === null
          ? 'n/a'
          : `**${fd.governance.value.medianHoursToMerge}h**`
      } to merge (n=${fd.governance.n}).\n\n`;

  md += `## Exploration (CodeMap holdout)\n\n`;
  md += fd.exploration.suppressed
    ? `${SUPPRESSED} — smaller arm has ${fd.exploration.n} session(s).\n\n`
    : `Exploration reduction, treatment vs control: ${
        fd.exploration.value.reductionPct === null
          ? 'n/a'
          : `**${fd.exploration.value.reductionPct}%**`
      } (${fd.exploration.value.label}; control n=${fd.exploration.value.controlSessions}, treatment n=${fd.exploration.value.treatmentSessions}).\n\n`;

  md += `## Memories at risk\n\n`;
  md += `_Populated by evidence drift detection (E3), which is not yet enabled._\n`;
  return md;
}
