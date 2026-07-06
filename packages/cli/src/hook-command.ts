import { readFileSync } from 'node:fs';
import {
  UserError,
  exitCodeForError,
  type ErrorExitCode,
} from '@teambrain/core';
import { resolveRuntimeDir, runSessionStartHook } from '@teambrain/mcp';
import { captureAndEmit, type CaptureHookName } from '@teambrain/hooks';

// `tb hook <event>` — the thin hook bodies Claude Code invokes (M4.3 +
// M5.2). Every hook exits 0 unconditionally: it must never fail an agent
// session (principle 2). session-start injects context; the capture hooks
// map+redact stdin and fire-and-forget to the daemon.

export const SUPPORTED_HOOKS = [
  'session-start',
  'post-tool-use',
  'stop',
  'session-end',
] as const;

const CAPTURE_EVENT: Record<string, CaptureHookName> = {
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
  'session-end': 'SessionEnd',
};

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export async function runHookCommand(
  event: string,
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  if (event === 'session-start') {
    // Writes hookSpecificOutput to stdout itself; never throws.
    await runSessionStartHook();
    return { exitCode: 0, output: '' };
  }

  const captureEvent = CAPTURE_EVENT[event];
  if (captureEvent !== undefined) {
    // Fire-and-forget capture: swallow every error so the session is never
    // affected (the whole point of a fire-and-forget hook).
    try {
      const payloadJson = readStdin().trim();
      if (payloadJson.length > 0) {
        await captureAndEmit({
          hookEvent: captureEvent,
          payloadJson,
          runtimeDir: resolveRuntimeDir(),
        });
      }
    } catch {
      /* graceful degradation: drop the event, keep the session healthy */
    }
    return { exitCode: 0, output: '' };
  }

  return {
    exitCode: exitCodeForError(
      new UserError(
        `unknown hook '${event}' — supported: ${SUPPORTED_HOOKS.join(', ')}`,
      ),
    ),
    output: `tb hook: unknown hook '${event}'\n`,
  };
}
