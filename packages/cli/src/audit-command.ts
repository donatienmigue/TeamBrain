import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { countRedactionMarkers } from '@teambrain/redact';
import {
  resolveRuntimeDir,
  sessionRecordPath,
  sessionSpoolDir,
} from '@teambrain/mcp';
import type { ErrorExitCode } from '@teambrain/core';

// M5.4 `tb audit`: render a session record exactly as stored, with a
// redaction summary. This is the trust feature — the user sees precisely what
// left their machine (redacted metadata), byte-for-byte from the spool.

export interface AuditOptions {
  runtimeDir?: string;
  /** Audit a specific session id; default is the most recent record. */
  sid?: string;
}

/** The most recently modified session record, or null when the spool is empty. */
function latestRecord(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const records = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl') && name !== 'feedback.jsonl')
    .map((name) => {
      const path = join(dir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return records[0]?.path ?? null;
}

function summarizeRedactions(recordText: string): string {
  const counts = countRedactionMarkers(recordText);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return 'Redaction summary: 0 replacements.';
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${count} ${type}`);
  return `Redaction summary: ${total} replacement${total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

export function runAuditCommand(options: AuditOptions = {}): {
  exitCode: 0 | ErrorExitCode;
  output: string;
} {
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  const recordPath =
    options.sid !== undefined
      ? sessionRecordPath(runtimeDir, options.sid)
      : latestRecord(sessionSpoolDir(runtimeDir));

  if (recordPath === null || !existsSync(recordPath)) {
    return {
      exitCode: 1,
      output:
        options.sid !== undefined
          ? `tb audit: no record for session ${options.sid}\n`
          : 'tb audit: no session records found in the spool yet\n',
    };
  }

  const raw = readFileSync(recordPath, 'utf8');
  const sid = basename(recordPath, '.jsonl');
  const eventCount = raw
    .split('\n')
    .filter((line) => line.trim().length > 0).length;

  // Printed exactly as stored — the record is the source of truth.
  const output =
    `Session ${sid} — ${eventCount} event${eventCount === 1 ? '' : 's'}\n` +
    `Record: ${recordPath}\n\n` +
    `${raw.trimEnd()}\n\n` +
    `${summarizeRedactions(raw)}\n`;
  return { exitCode: 0, output };
}
