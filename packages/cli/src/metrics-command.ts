import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntimeDir } from '@teambrain/mcp';
import { gitSessionSource, type SessionSource } from '@teambrain/distill';
import { exitCodeForError, UserError } from '@teambrain/core';
import type { ErrorExitCode, SessionEvent } from '@teambrain/core';
import { aggregateDigest, type DigestReport } from './digest/aggregate.js';
import {
  loadActiveMemories,
  readRequiredBudget,
} from './digest/digest-command.js';
import {
  runDoctorCommand,
  doctorReportSchema,
  type DoctorReport,
} from './doctor-command.js';

// PM §5 `tb metrics`: a read-only, on-demand local snapshot for a developer
// debugging "why is my context slow/noisy" — index size, latency percentiles
// (from the daemon), injection weight, and required-memory load. It captures
// nothing and writes nothing; it reuses the digest aggregation + the doctor
// heartbeat, so it introduces no new privacy surface (Acceptance §7).

export interface MetricsCommandOptions {
  json?: boolean;
  runtimeDir?: string;
  brainDir?: string;
  /** Override the sessions source (tests). */
  sessions?: SessionSource;
  now?: Date;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function eventsFrom(source: SessionSource): SessionEvent[] {
  return source.readNewRecords(null).flatMap((record) => record.events);
}

interface MetricsSnapshot {
  index: {
    docCount: number | null;
    dbSizeBytes: number | null;
    reindexCount: number | null;
  };
  latency: DoctorReport['latency'];
  contextMetrics: DigestReport['contextMetrics'];
  netEfficiency: DigestReport['netEfficiency'];
}

export async function runMetricsCommand(
  repoDir: string,
  options: MetricsCommandOptions = {},
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  const root = git(['rev-parse', '--show-toplevel'], repoDir);
  try {
    if (root === null) throw new UserError(`${repoDir} is not a git repository`);
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as ErrorExitCode,
      output: `tb metrics: ${(err as Error).message}\n`,
    };
  }
  const repoRoot = root;
  const brainDir = options.brainDir ?? join(repoRoot, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: 1,
      output: `tb metrics: no ${brainDir} — run \`tb init\` first\n`,
    };
  }

  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();

  // Reuse the doctor snapshot for the live daemon metrics (latency + index).
  const doctorOut = await runDoctorCommand({ runtimeDir, json: true });
  const doctor = doctorReportSchema.parse(JSON.parse(doctorOut.output));

  // Reuse the digest aggregation for the context-efficiency metrics.
  const sessions = options.sessions ?? gitSessionSource(repoRoot);
  const report = aggregateDigest({
    events: eventsFrom(sessions),
    active: loadActiveMemories(brainDir),
    retiredCount: 0,
    proposedCount: 0,
    rules: [],
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(readRequiredBudget(brainDir) === undefined
      ? {}
      : { requiredBudget: readRequiredBudget(brainDir) }),
  });

  const snapshot: MetricsSnapshot = {
    index: {
      docCount: doctor.index.docCount,
      dbSizeBytes: doctor.index.dbSizeBytes,
      reindexCount: doctor.index.reindexCount,
    },
    latency: doctor.latency,
    contextMetrics: report.contextMetrics,
    netEfficiency: report.netEfficiency,
  };

  if (options.json === true) {
    return { exitCode: 0, output: `${JSON.stringify(snapshot, null, 2)}\n` };
  }
  return { exitCode: 0, output: renderHuman(snapshot) };
}

function ms(m: { p50Ms: number | null; p95Ms: number | null }): string {
  return m.p95Ms === null ? 'no samples' : `p50 ${m.p50Ms}ms / p95 ${m.p95Ms}ms`;
}

function renderHuman(s: MetricsSnapshot): string {
  const cm = s.contextMetrics;
  const rl = cm.requiredLoad;
  let out = 'tb metrics (local snapshot, read-only)\n';
  out += `  index docs:        ${s.index.docCount ?? 'unknown'}`;
  out += `${s.index.dbSizeBytes === null ? '' : ` (${Math.round(s.index.dbSizeBytes / 1024)}KB on disk)`}\n`;
  out += `  injection latency: ${ms(s.latency.injection)} (NFR <500ms)\n`;
  out += `  search latency:    ${ms(s.latency.search)} (NFR <300ms)\n`;
  out += `  hook latency:      ${ms(s.latency.hook)} (NFR <20ms)\n`;
  out += `  injection weight:  median ${cm.injectionWeight.median} tokens/session (n=${cm.sessionsWithInjection})\n`;
  out += `  required load:     ${rl.count} memories / ${rl.tokens} tokens${rl.overBudget ? ` ⚠️ OVER budget ${rl.budget}` : ` (budget ${rl.budget})`}\n`;
  out += `  codemap util:      ${cm.utilization.rate === null ? 'n/a' : `${Math.round(cm.utilization.rate * 100)}%`}\n`;
  out += `  served staleness:  ${cm.servedStaleness.rate === null ? 'n/a' : `${Math.round(cm.servedStaleness.rate * 100)}%`}\n`;
  out += `  net efficiency:    ${s.netEfficiency.verdict}\n`;
  return out;
}
