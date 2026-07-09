import { CursorInterceptor } from '@teambrain/hooks/cursor';
import { resolveRuntimeDir } from '@teambrain/mcp';
import { sendHookEvent } from '@teambrain/mcp/hook-client';
import type { ToolContext } from '@teambrain/mcp';
import { buildHookContext } from '@teambrain/hooks';

export function wrapCursorContext(context: ToolContext, repoDir: string): ToolContext {
  const hookCtx = buildHookContext({
    cwd: repoDir,
    sid: 'placeholder', // not used, CursorInterceptor sets its own
    tool: 'cursor',
    model: 'unknown',
  });

  const interceptor = new CursorInterceptor(hookCtx);
  const runtimeDir = resolveRuntimeDir();

  return {
    ...context,
    onToolCall: (name, args) => {
      const events = interceptor.processCall({ method: name, args });
      for (const event of events) {
        // Fire and forget (principle 2)
        sendHookEvent(runtimeDir, event).catch(() => {});
      }
    },
  };
}

