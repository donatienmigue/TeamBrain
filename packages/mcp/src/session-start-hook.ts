import { resolveRuntimeDir } from './paths.js';
import { requestSessionContext } from './hook-client.js';
import { SESSION_CONTEXT_MAX_CHARS } from './context.js';

// M4.3 SessionStart hook body. Asks the daemon for the context bundle and
// emits Claude Code's hookSpecificOutput.additionalContext. It must never
// block or throw: on any failure (daemon down, timeout) it writes nothing
// and the session proceeds memory-less (principle 2 / TECH_BRIEF §4.4).

export interface SessionStartHookOptions {
  runtimeDir?: string;
  scope?: 'team' | 'org';
  timeoutMs?: number;
  /** Sink for the emitted JSON; defaults to process.stdout. */
  write?: (text: string) => void;
}

export async function runSessionStartHook(
  options: SessionStartHookOptions = {},
): Promise<void> {
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  let bundle = '';
  try {
    bundle = await requestSessionContext(runtimeDir, {
      ...(options.scope === undefined ? {} : { scope: options.scope }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  } catch {
    bundle = '';
  }
  // Empty output on failure (M4.3): emit nothing at all so the hook is a no-op.
  if (bundle.length === 0) return;
  const additionalContext = bundle.slice(0, SESSION_CONTEXT_MAX_CHARS);
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };
  const write =
    options.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  write(JSON.stringify(payload));
}
