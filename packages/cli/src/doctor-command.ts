import { existsSync, readFileSync } from 'node:fs';
import {
  daemonSocketPath,
  heartbeatPath,
  indexDbPath,
  pingDaemon,
  resolveRuntimeDir,
} from '@teambrain/mcp';
import type { ErrorExitCode } from '@teambrain/core';

// M4.3 minimal `tb doctor` (the daemon-heartbeat slice; M7.2 fills in the
// rest per Tech Brief §6). Reports whether the daemon is running and
// reachable and how fresh the index is, from the heartbeat file + a socket
// ping. Exit 0 when the daemon is reachable, 2 (environment) when not.

export interface DoctorOptions {
  json?: boolean;
  runtimeDir?: string;
}

interface Heartbeat {
  pid?: number;
  lastBeat?: string;
  docCount?: number;
  lexicalOnly?: boolean;
  brainDir?: string;
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

export async function runDoctorCommand(
  options: DoctorOptions = {},
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  const hbPath = heartbeatPath(runtimeDir);
  let heartbeat: Heartbeat = {};
  if (existsSync(hbPath)) {
    try {
      heartbeat = JSON.parse(readFileSync(hbPath, 'utf8')) as Heartbeat;
    } catch {
      heartbeat = {};
    }
  }
  const pong = await pingDaemon(runtimeDir);
  const reachable = pong !== null;
  const pid = pong?.pid ?? heartbeat.pid ?? null;
  const running = reachable || processAlive(pid);

  const report = {
    ok: reachable,
    daemon: {
      running,
      reachable,
      pid,
      socket: daemonSocketPath(runtimeDir),
      lastBeat: heartbeat.lastBeat ?? null,
    },
    index: {
      docCount: pong?.doc_count ?? heartbeat.docCount ?? null,
      lexicalOnly: heartbeat.lexicalOnly ?? null,
      brainDir: heartbeat.brainDir ?? null,
      dbPath: indexDbPath(runtimeDir),
    },
  };
  const exitCode: 0 | ErrorExitCode = reachable ? 0 : 2;

  if (options.json === true) {
    return { exitCode, output: `${JSON.stringify(report, null, 2)}\n` };
  }

  const mark = (ok: boolean): string => (ok ? 'ok' : 'FAIL');
  let output = 'tb doctor — daemon\n';
  output += `  daemon running:   ${mark(running)}${pid === null ? '' : ` (pid ${pid})`}\n`;
  output += `  socket reachable: ${mark(reachable)} (${report.daemon.socket})\n`;
  output += `  index docs:       ${report.index.docCount ?? 'unknown'}${report.index.lexicalOnly === true ? ' (lexical-only)' : ''}\n`;
  output += `  brain:            ${report.index.brainDir ?? 'unknown'}\n`;
  if (!reachable) {
    output +=
      '\nThe daemon is not reachable. Start it with `tb serve` in the repo ' +
      'that holds the brain; sessions run memory-less until then.\n';
  }
  return { exitCode, output };
}
