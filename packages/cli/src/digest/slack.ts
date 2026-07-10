import type { DigestReport } from './aggregate.js';

// M7.1 Slack rendering + delivery. This is the *only* network egress in the
// digest path (guideline 4: git, the LLM Provider in distill, and this webhook
// are the sole allowed calls). The payload is a Slack incoming-webhook message;
// `postDigest` is best-effort and never throws to the caller.

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

function section(markdown: string): unknown {
  return { type: 'section', text: { type: 'mrkdwn', text: markdown } };
}

/** Renders a digest report into a Slack incoming-webhook payload. */
export function renderSlackMessage(report: DigestReport): SlackMessage {
  const { memories } = report;
  const summary =
    `${memories.proposed} proposed · ${memories.approved} approved · ` +
    `${memories.retired} retired`;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'TeamBrain weekly digest' },
    },
    section(`*Memories:* ${summary}`),
  ];

  if (report.topRetrieved.length > 0) {
    const lines = report.topRetrieved
      .map((entry) => `• \`${entry.id}\` — ${entry.retrievals} retrieval(s)`)
      .join('\n');
    blocks.push(section(`*Top retrieved*\n${lines}`));
  }

  blocks.push(
    section(`*No-hit searches:* ${report.noHitSearches} (documentation gaps)`),
  );

  if (report.stale.length > 0) {
    const lines = report.stale
      .map(
        (memory) =>
          `• \`${memory.id}\` — "${memory.title}" (since ${memory.created})`,
      )
      .join('\n');
    blocks.push(section(`*Stale (no retrieval ≥90d)*\n${lines}`));
  }

  if (report.governance !== undefined) {
    const g = report.governance;
    blocks.push(
      section(
        `*Governance friction:* ${g.mergedProposalPRs} proposal PR(s) merged` +
          (g.medianHoursToMerge === null
            ? ''
            : ` · median time-to-merge ${g.medianHoursToMerge}h`),
      ),
    );
  }

  const { practice } = report;
  if (practice.sessions > 0) {
    const o = practice.outcomes;
    const co = practice.outcomesByRetrieval;
    const lines = [
      `• Sessions: ${practice.sessions} (${practice.ended} ended) — ` +
        `${o.committed} committed · ${o.abandoned} abandoned · ${o.unknown} unknown`,
      `• Retries/session: median ${practice.retries.median}, max ${practice.retries.max} · ` +
        `failed commands/session: median ${practice.failedCommands.median}`,
      `• Plan revisions/session: median ${practice.planRevisions.median}`,
      `• Memory retrieval rate: ${Math.round(practice.retrievalRate * 100)}% · ` +
        `context-setup events/session: median ${practice.contextSetupEvents.median}`,
      `• With retrieval: ${co.retrieved.committed} committed / ${co.retrieved.abandoned} abandoned · ` +
        `without: ${co.unretrieved.committed} committed / ${co.unretrieved.abandoned} abandoned`,
    ].join('\n');
    blocks.push(section(`*Practice signals (aggregate-only)*\n${lines}`));
  }

  const drifted = report.drift.filter((entry) => entry.changed);
  if (drifted.length > 0) {
    const lines = drifted.map((entry) => `• \`${entry.file}\``).join('\n');
    blocks.push(section(`*Rules drift detected*\n${lines}`));
  }

  return {
    text: `TeamBrain weekly digest — ${summary}`,
    blocks,
  };
}

/**
 * Posts the message to a Slack incoming webhook. Best-effort: returns whether
 * it succeeded, never throws (a failed digest post must not fail the CI job).
 */
export async function postDigest(
  webhookUrl: string,
  message: SlackMessage,
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    return response.ok;
  } catch {
    return false;
  }
}
