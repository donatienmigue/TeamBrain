import {
  CursorInterceptor,
  CURSOR_IDLE_TIMEOUT_MS,
} from '@teambrain/hooks/cursor';
import type { SessionEvent } from '@teambrain/core';
import { resolveRuntimeDir } from '@teambrain/mcp';
import { sendHookEvent } from '@teambrain/mcp/hook-client';
import type { ToolContext } from '@teambrain/mcp';
import { buildHookContext } from '@teambrain/hooks';
import { createLogger } from '@teambrain/core';

// The Tier-B capture path: wraps the MCP server's tool context so session
// boundaries are inferred from MCP calls (start on memory_context; end on
// memory_propose or 30-min idle). Built for Cursor, shared by every
// mcp-inference adapter — the envelope's `tool` carries the client id, so
// events stay distinguishable per vendor.

const log = createLogger();

export function wrapInferenceContext(
  context: ToolContext,
  repoDir: string,
  tool: string,
): ToolContext {
  const hookCtx = buildHookContext({
    cwd: repoDir,
    sid: 'placeholder', // not used, CursorInterceptor sets its own
    tool,
    model: 'unknown',
  });

  const interceptor = new CursorInterceptor(hookCtx);
  const runtimeDir = resolveRuntimeDir();

  const send = (events: SessionEvent[]): void => {
    for (const event of events) {
      // Fire and forget (principle 2); degradation logged, never silent.
      sendHookEvent(runtimeDir, event).catch((err: unknown) => {
        log.debug('inference capture event dropped: daemon unreachable', {
          tool,
          ev: event.ev,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    }
  };

  // Sessions that never propose a memory only end by idle timeout; the
  // interceptor detects expiry lazily on the next call, and this timer
  // covers sessions that never see another call. unref'd so an idle
  // daemon can still exit.
  let idleFlush: NodeJS.Timeout | undefined;
  const armIdleFlush = (): void => {
    if (idleFlush !== undefined) clearTimeout(idleFlush);
    idleFlush = setTimeout(
      () => send(interceptor.flushIdle()),
      CURSOR_IDLE_TIMEOUT_MS + 1000,
    );
    idleFlush.unref();
  };

  return {
    ...context,
    onToolCall: (name, args) => {
      send(interceptor.processCall({ method: name, args }));
      armIdleFlush();
    },
  };
}
