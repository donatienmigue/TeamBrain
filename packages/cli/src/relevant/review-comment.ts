import type { RelevantRow } from './relevant-command.js';

// E4.2/E4.3 review-time comment. The Action renders ONE sticky comment from
// `tb relevant --json`. Hard constraints (EVIDENCE_BRIEF §E.4): the body
// carries only what is already public in the repo — memory id, title, class —
// never session data, authorship, or retrieval telemetry (the RelevantRow type
// is the guarantee: it has no other fields). The marker makes the comment
// idempotent: the Action finds it and updates in place, so N pushes yield one
// comment, not N.

export const REVIEW_MARKER = '<!-- teambrain-memory-review -->';
export const MAX_ROWS = 5;

/** A retirement deep-link: the exact `tb retire` a reviewer runs if it's stale. */
function retireHint(id: string): string {
  return `\`tb retire ${id} "no longer accurate (PR review)"\``;
}

/**
 * Renders the sticky comment body. `shown` is capped at 5. Every row offers
 * *still true* (a no-op acknowledgement) and *propose retirement* (the retire
 * command). Returns null when there is nothing to show, so the caller posts
 * nothing.
 */
export function renderReviewComment(
  rows: readonly RelevantRow[],
): string | null {
  const shown = rows.slice(0, MAX_ROWS);
  if (shown.length === 0) return null;
  let body = `${REVIEW_MARKER}\n`;
  body += `### 🧠 TeamBrain — team memories relevant to this change\n\n`;
  body += `These already-approved memories touch the files in this PR. If one is `;
  body += `no longer accurate, that's a great thing to fix while you're here.\n\n`;
  body += `| memory | class | is it still true? |\n|---|---|---|\n`;
  for (const r of shown) {
    body += `| ${r.title} (\`${r.id}\`) | ${r.class} | ✅ still true · 🗑️ propose retirement → ${retireHint(r.id)} |\n`;
  }
  body += `\n_Read-only from your brain (id · title · class only — never `;
  body += `per-developer telemetry). Opt out with \`review.enabled: false\` in `;
  body += `\`brain.yaml\`._\n`;
  return body;
}
