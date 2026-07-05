import {
  UserError,
  exitCodeForError,
  type ErrorExitCode,
} from '@teambrain/core';
import { runSessionStartHook } from '@teambrain/mcp';

// `tb hook <event>` — the thin hook bodies Claude Code invokes. M4.3 ships
// session-start (context injection); M5.2 adds the capture hooks. Every hook
// exits 0 unconditionally: it must never fail an agent session (principle 2).

export const SUPPORTED_HOOKS = ['session-start'] as const;

export async function runHookCommand(
  event: string,
): Promise<{ exitCode: 0 | ErrorExitCode; output: string }> {
  if (event === 'session-start') {
    // runSessionStartHook writes hookSpecificOutput to stdout itself and
    // never throws; we always exit 0 with no extra output.
    await runSessionStartHook();
    return { exitCode: 0, output: '' };
  }
  // An unknown hook name is a wiring mistake worth surfacing (still exit 1,
  // not a crash) — but this never runs in the agent hook path.
  return {
    exitCode: exitCodeForError(
      new UserError(
        `unknown hook '${event}' — supported: ${SUPPORTED_HOOKS.join(', ')}`,
      ),
    ),
    output: `tb hook: unknown hook '${event}'\n`,
  };
}
