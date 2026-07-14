import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  daemonSocketPath,
  ensureDaemon,
  heartbeatPath,
  indexDbPath,
  pingDaemon,
  resolveRuntimeDir,
} from '@teambrain/mcp';
import type { ErrorExitCode } from '@teambrain/core';
import { ADAPTERS } from '@teambrain/hooks';
import type { GovernanceFriction } from './digest/aggregate.js';

// M7.2 `tb doctor` per Tech Brief §6: env + self-observability checks — daemon
// liveness, index freshness, last sync/reindex, per-tool hook heartbeats,
// retrieval p95 over the daemon's last 100 context renders, and brain
// branch-sync. The report has a frozen, zod-validated schema (the Accept's
// `--json` schema test); exit 0 when the daemon is reachable, 2 otherwise.

// --- report schema (validated on every run; the JSON output is this shape) ---

export const doctorReportSchema = z.object({
  ok: z.boolean(),
  generatedAt: z.string(),
  daemon: z.object({
    running: z.boolean(),
    reachable: z.boolean(),
    pid: z.number().int().nullable(),
    socket: z.string(),
    startedAt: z.string().nullable(),
    lastBeat: z.string().nullable(),
    uptimeSeconds: z.number().nonnegative().nullable(),
  }),
  index: z.object({
    docCount: z.number().int().nullable(),
    lexicalOnly: z.boolean().nullable(),
    brainChecksum: z.string().nullable(),
    brainDir: z.string().nullable(),
    dbPath: z.string(),
    lastReindexAt: z.string().nullable(),
  }),
  retrieval: z.object({
    p95Ms: z.number().nonnegative().nullable(),
    samples: z.number().int().nonnegative(),
  }),
  // D3.1 governance friction (additive, optional: absent when gh/remote is
  // unavailable). Median hours from proposal-PR creation to merge.
  governance: z
    .object({
      mergedProposalPRs: z.number().int().nonnegative(),
      medianHoursToMerge: z.number().nonnegative().nullable(),
    })
    .optional(),
  hooks: z.array(
    z.object({
      tool: z.string(),
      lastEventAt: z.string(),
      count: z.number().int().nonnegative(),
      captureLevel: z.string().optional(),
    }),
  ),
  sync: z.object({
    branch: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
  }),
  checks: z.array(
    z.object({ name: z.string(), ok: z.boolean(), detail: z.string() }),
  ),
});
export type DoctorReport = z.infer<typeof doctorReportSchema>;

export interface DoctorOptions {
  json?: boolean;
  runtimeDir?: string;
  now?: () => Date;
  /**
   * `--fix`: when the daemon is down, start it (daemon auto-start) and report
   * the result. Without the flag doctor NEVER spawns — it must truthfully
   * report "daemon down".
   */
  fix?: boolean;
  /** Injected for tests; defaults to the real ensureDaemon. */
  autostart?: (runtimeDir: string) => Promise<boolean>;
  /**
   * Governance metric to include (D3.1). Deliberately not defaulted here:
   * the CLI layer supplies the live `gh` query so this function — and every
   * test of it — stays free of subprocess/network side effects.
   */
  governance?: GovernanceFriction;
}

// The daemon heartbeat file (M4.1 + M7.2 fields). Everything is optional so an
// older or partial heartbeat still parses; doctor degrades to nulls.
const heartbeatSchema = z
  .object({
    pid: z.number().int().optional(),
    startedAt: z.string().optional(),
    lastBeat: z.string().optional(),
    docCount: z.number().int().optional(),
    lexicalOnly: z.boolean().optional(),
    brainChecksum: z.string().nullable().optional(),
    brainDir: z.string().optional(),
    lastReindexAt: z.string().optional(),
    hooks: z
      .record(
        z.string(),
        z.object({ lastEventAt: z.string(), count: z.number().int() }),
      )
      .optional(),
    retrieval: z
      .object({ p95Ms: z.number().nullable(), samples: z.number().int() })
      .optional(),
  })
  .loose();
type Heartbeat = z.infer<typeof heartbeatSchema>;

function readHeartbeat(path: string): Heartbeat {
  if (!existsSync(path)) return {};
  try {
    const parsed = heartbeatSchema.safeParse(
      JSON.parse(readFileSync(path, 'utf8')),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function processAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryGit(args: string[], cwd: string): string | null {
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

/** Brain branch-sync vs its upstream; all null when there's no repo/upstream. */
function branchSync(brainDir: string | null): DoctorReport['sync'] {
  const none = { branch: null, ahead: null, behind: null };
  if (
    brainDir === null ||
    tryGit(['rev-parse', '--show-toplevel'], brainDir) === null
  ) {
    return none;
  }
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], brainDir);
  const counts = tryGit(
    ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
    brainDir,
  );
  if (counts === null) {
    return { branch, ahead: null, behind: null };
  }
  const [behind, ahead] = counts
    .split(/\s+/)
    .map((n) => Number.parseInt(n, 10));
  return {
    branch,
    ahead: Number.isNaN(ahead) ? null : (ahead as number),
    behind: Number.isNaN(behind) ? null : (behind as number),
  };
}

export async function runDoctorCommand(
  options: DoctorOptions = {},
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  const now = options.now ?? ((): Date => new Date());
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();

  // --fix only: attempt an auto-start before diagnosing, so the report below
  // reflects the fixed state. Plain doctor never spawns anything.
  let fixAttempted = false;
  let fixResult = false;
  if (options.fix === true && (await pingDaemon(runtimeDir)) === null) {
    const autostart =
      options.autostart ??
      ((dir: string): Promise<boolean> =>
        ensureDaemon({ runtimeDir: dir, enabled: true }));
    fixAttempted = true;
    fixResult = await autostart(runtimeDir);
  }

  const heartbeat = readHeartbeat(heartbeatPath(runtimeDir));

  const pong = await pingDaemon(runtimeDir);
  const reachable = pong !== null;
  const pid = pong?.pid ?? heartbeat.pid ?? null;
  const running = reachable || processAlive(pid);

  const startedAt = heartbeat.startedAt ?? null;
  const uptimeSeconds =
    startedAt === null
      ? null
      : Math.max(
          0,
          Math.round((now().getTime() - new Date(startedAt).getTime()) / 1000),
        );

  const brainDir = heartbeat.brainDir ?? null;
  const hooks = Object.entries(heartbeat.hooks ?? {})
    .map(([tool, hb]) => ({
      tool,
      lastEventAt: hb.lastEventAt,
      count: hb.count,
      captureLevel: ADAPTERS[tool]?.describeDegradation(),
    }))
    .sort((a, b) => a.tool.localeCompare(b.tool));

  const sync = branchSync(brainDir);

  const checks: DoctorReport['checks'] = [
    {
      name: 'daemon-reachable',
      ok: reachable,
      detail: reachable ? 'socket answered ping' : 'no response on socket',
    },
    {
      name: 'index-loaded',
      ok: (pong?.doc_count ?? heartbeat.docCount ?? 0) > 0,
      detail: `${pong?.doc_count ?? heartbeat.docCount ?? 0} document(s)`,
    },
    {
      name: 'branch-synced',
      ok: sync.behind === null || sync.behind === 0,
      detail:
        sync.behind === null
          ? 'no upstream to compare'
          : `${sync.behind} commit(s) behind upstream`,
    },
  ];
  if (fixAttempted) {
    checks.push({
      name: 'autostart-fix',
      ok: fixResult,
      detail: fixResult
        ? 'daemon was down; auto-start brought it up'
        : 'daemon was down; auto-start failed (see `tb serve`)',
    });
  }

  const report: DoctorReport = {
    ok: reachable,
    generatedAt: now().toISOString(),
    daemon: {
      running,
      reachable,
      pid,
      socket: daemonSocketPath(runtimeDir),
      startedAt,
      lastBeat: heartbeat.lastBeat ?? null,
      uptimeSeconds,
    },
    index: {
      docCount: pong?.doc_count ?? heartbeat.docCount ?? null,
      lexicalOnly: heartbeat.lexicalOnly ?? null,
      brainChecksum: heartbeat.brainChecksum ?? null,
      brainDir,
      dbPath: indexDbPath(runtimeDir),
      lastReindexAt: heartbeat.lastReindexAt ?? null,
    },
    retrieval: {
      p95Ms: heartbeat.retrieval?.p95Ms ?? null,
      samples: heartbeat.retrieval?.samples ?? 0,
    },
    hooks,
    sync,
    checks,
  };
  if (options.governance !== undefined) report.governance = options.governance;

  // Validate our own output — the report shape is a contract (Accept: schema).
  doctorReportSchema.parse(report);
  const exitCode: 0 | ErrorExitCode = reachable ? 0 : 2;

  if (options.json === true) {
    return { exitCode, output: `${JSON.stringify(report, null, 2)}\n` };
  }
  return { exitCode, output: renderHuman(report) };
}

function mark(ok: boolean): string {
  return ok ? 'ok' : 'FAIL';
}

function renderHuman(report: DoctorReport): string {
  const { daemon, index, retrieval, hooks, sync } = report;
  let out = 'tb doctor\n';
  out += `  daemon running:   ${mark(daemon.running)}${daemon.pid === null ? '' : ` (pid ${daemon.pid})`}\n`;
  out += `  socket reachable: ${mark(daemon.reachable)} (${daemon.socket})\n`;
  const fix = report.checks.find((check) => check.name === 'autostart-fix');
  if (fix !== undefined) {
    out += `  autostart fix:    ${mark(fix.ok)} (${fix.detail})\n`;
  }
  out += `  uptime:           ${daemon.uptimeSeconds === null ? 'unknown' : `${daemon.uptimeSeconds}s`}\n`;
  out += `  index docs:       ${index.docCount ?? 'unknown'}${index.lexicalOnly === true ? ' (lexical-only)' : ''}\n`;
  out += `  index checksum:   ${index.brainChecksum ?? 'unknown'}\n`;
  out += `  last reindex:     ${index.lastReindexAt ?? 'unknown'}\n`;
  out += `  retrieval p95:    ${retrieval.p95Ms === null ? 'no samples' : `${retrieval.p95Ms}ms (n=${retrieval.samples})`}\n`;
  if (report.governance !== undefined) {
    const g = report.governance;
    out += `  proposal merges:  ${g.mergedProposalPRs} PR(s)${
      g.medianHoursToMerge === null
        ? ''
        : `, median ${g.medianHoursToMerge}h to merge`
    }\n`;
  }
  out += `  brain:            ${index.brainDir ?? 'unknown'}\n`;
  out += `  branch sync:      ${sync.branch ?? 'unknown'}${
    sync.behind === null
      ? ''
      : ` (behind ${sync.behind}, ahead ${sync.ahead ?? 0})`
  }\n`;
  if (hooks.length === 0) {
    out += '  hooks:            none seen this session\n';
  } else {
    out += '  hooks:\n';
    for (const hook of hooks) {
      out += `    - ${hook.tool}: ${hook.count} event(s), last ${hook.lastEventAt}\n`;
      if (hook.captureLevel !== undefined) {
        out += `      (${hook.captureLevel})\n`;
      }
    }
  }
  if (!report.ok) {
    out +=
      '\nThe daemon is not reachable. Start it with `tb serve` in the repo ' +
      'that holds the brain; sessions run memory-less until then.\n';
  }
  return out;
}
