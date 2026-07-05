import { sendHookEvent } from '@teambrain/mcp/hook-client';
import type { SessionEvent } from '@teambrain/core';

// Fire-and-forget delivery to the daemon socket. Imported via the mcp
// hook-client subpath so a hook process never loads the index / better-sqlite3
// — it stays a thin, fast client (principle 2, TECH_BRIEF §4.4).

export function emitEvent(
  runtimeDir: string,
  event: SessionEvent,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  return sendHookEvent(runtimeDir, event, options);
}
