import { z } from 'zod';

// E1 / ADR-6: `tb verify` re-asserts TeamBrain's published privacy invariants
// at runtime, on the user's own machine and data, and emits a report suitable
// for a security review. This module is the framework: check types, the
// under-claimed egress allowlist (printed in full, F8 included), exit-code
// resolution, and the human + JSON renderers. The checks themselves live in
// checks.ts; the orchestrator in verify-command.ts.
//
// Exit-code discipline is the whole product here (EVIDENCE_BRIEF §E.1):
//   0  every check passed
//   2  a check could not run (environment) — reported UNVERIFIED, never PASS
//   3  an invariant is violated
// `2` and `3` are never conflated. Running outside a brain repo is exit 1,
// resolved by the orchestrator before any check runs.

export type CheckStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';

export interface CheckOutcome {
  /** Stable id, V1..V8; drives deterministic ordering. */
  readonly id: string;
  readonly name: string;
  readonly status: CheckStatus;
  /** The narrowest true statement this check proves (guardrail: under-claim). */
  readonly claim: string;
  /** Human-readable evidence lines. MUST never contain a scanned secret value. */
  readonly evidence: readonly string[];
}

/**
 * One allowed network destination, printed verbatim in every report. Listing
 * the embedding-model CDN here (rather than quietly excluding it) is the F8
 * resolution: under-claiming is free, over-claiming is fatal.
 */
export interface AllowedEgress {
  readonly host: string;
  readonly purpose: string;
  readonly source: string;
}

export const EGRESS_ALLOWLIST: readonly AllowedEgress[] = [
  {
    host: '<your brain git remote>',
    purpose: 'brain sync (push/pull), via the git subprocess',
    source: 'child_process git',
  },
  {
    host: 'api.anthropic.com (or the brain.yaml-configured Provider host)',
    purpose:
      'distiller LLM calls — packages/distill only, never at capture time',
    source: 'distill/src/anthropic.ts (C5 Provider)',
  },
  {
    host: '<brain.yaml digest webhook, e.g. hooks.slack.com>',
    purpose: 'weekly digest post (opt-in; only when a webhook is configured)',
    source: 'cli/src/digest/slack.ts',
  },
  {
    host: 'storage.googleapis.com/qdrant-fastembed',
    purpose:
      'one-time, checksum-pinned embedding-model download to ~/.teambrain/models/',
    source: 'index/src/embeddings.ts (AUDIT F8 — the fourth egress point)',
  },
] as const;

export interface CheckContext {
  /** The repo whose brain is being verified. */
  readonly repoDir: string;
  /** `<repoDir>/.teambrain`; the orchestrator guarantees it exists (exit 1 else). */
  readonly brainDir: string;
  /** Machine-local runtime dir (~/.teambrain or TEAMBRAIN_HOME). */
  readonly runtimeDir: string;
  /** No network is available / permitted; provenance degrades to UNVERIFIED. */
  readonly offline: boolean;
  /** `--strict`: opt into the OS-sandbox egress tier (OQ-8). */
  readonly strict: boolean;
  readonly now: () => Date;
}

export interface Check {
  readonly id: string;
  readonly name: string;
  run(ctx: CheckContext): CheckOutcome | Promise<CheckOutcome>;
}

/** 3 beats 2 beats 0: a violation always outranks an environment gap. */
export function resolveExitCode(outcomes: readonly CheckOutcome[]): 0 | 2 | 3 {
  if (outcomes.some((o) => o.status === 'FAIL')) return 3;
  if (outcomes.some((o) => o.status === 'UNVERIFIED')) return 2;
  return 0;
}

export function verdictFor(exitCode: 0 | 2 | 3): CheckStatus {
  if (exitCode === 3) return 'FAIL';
  if (exitCode === 2) return 'UNVERIFIED';
  return 'PASS';
}

// --- report shape (the --json contract; golden-tested) ---

const allowedEgressSchema = z.object({
  host: z.string(),
  purpose: z.string(),
  source: z.string(),
});

const checkOutcomeSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
  claim: z.string(),
  evidence: z.array(z.string()),
});

export const verifyReportSchema = z.object({
  tool: z.literal('tb verify'),
  verdict: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
  exitCode: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  version: z.string(),
  provenanceCommit: z.string().nullable(),
  brainMemoryCount: z.number().int().nonnegative().nullable(),
  generatedAt: z.string(),
  allowlist: z.array(allowedEgressSchema),
  checks: z.array(checkOutcomeSchema),
});
export type VerifyReport = z.infer<typeof verifyReportSchema>;

export interface ReportMeta {
  readonly version: string;
  readonly provenanceCommit: string | null;
  readonly brainMemoryCount: number | null;
  readonly generatedAt: string;
}

/** Deterministic ordering so two runs diff cleanly. */
function ordered(outcomes: readonly CheckOutcome[]): CheckOutcome[] {
  return [...outcomes].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildReport(
  outcomes: readonly CheckOutcome[],
  meta: ReportMeta,
): VerifyReport {
  const checks = ordered(outcomes);
  const exitCode = resolveExitCode(checks);
  const report: VerifyReport = {
    tool: 'tb verify',
    verdict: verdictFor(exitCode),
    exitCode,
    version: meta.version,
    provenanceCommit: meta.provenanceCommit,
    brainMemoryCount: meta.brainMemoryCount,
    generatedAt: meta.generatedAt,
    allowlist: EGRESS_ALLOWLIST.map((a) => ({ ...a })),
    checks: checks.map((o) => ({ ...o, evidence: [...o.evidence] })),
  };
  // Validate our own output — the JSON shape is a contract (Accept: golden).
  verifyReportSchema.parse(report);
  return report;
}

function statusMark(status: CheckStatus): string {
  return status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'UNVERIFIED';
}

/** Markdown, pasteable into a security review. Deterministic ordering. */
export function renderHuman(report: VerifyReport): string {
  let out = `# tb verify — ${report.verdict}\n\n`;
  out += `Re-asserts TeamBrain's published privacy invariants on THIS machine,\n`;
  out += `against THIS repo's own data. Verdict is the worst check below.\n\n`;

  out += `## Network egress allowlist (the only destinations TeamBrain may reach)\n\n`;
  for (const a of report.allowlist) {
    out += `- \`${a.host}\` — ${a.purpose}  \n  _(${a.source})_\n`;
  }
  out += `\n`;

  out += `## Checks\n\n`;
  for (const c of report.checks) {
    out += `### ${c.id} · ${c.name} — ${statusMark(c.status)}\n`;
    out += `${c.claim}\n`;
    for (const line of c.evidence) out += `  - ${line}\n`;
    out += `\n`;
  }

  out += `---\n`;
  out += `tb ${report.version}`;
  out += ` · provenance ${report.provenanceCommit ?? 'UNVERIFIED'}`;
  out += ` · ${report.brainMemoryCount ?? 'unknown'} memories`;
  out += ` · ${report.generatedAt}\n`;
  return out;
}

export function renderJson(report: VerifyReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
