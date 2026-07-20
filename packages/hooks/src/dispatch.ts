import type { SessionEvent } from '@teambrain/core';
import { sendTiming } from '@teambrain/mcp/hook-client';
import { buildHookContext } from './context.js';
import { processHookPayload, type CaptureHookName } from './run.js';
import { emitEvent } from './emit.js';
import { redactEvent } from './redact-event.js';
import { ADAPTERS } from './registry.js';

// The full capture-hook body the CLI invokes: build context from the
// environment, map+redact the payload, and fire-and-forget to the daemon.
// Returns the produced event (or null) for logging/tests. Never long-running.

export interface CaptureAndEmitParams {
  hookEvent: CaptureHookName;
  payloadJson: string;
  runtimeDir: string;
  /** Working dir the session ran in; defaults to the payload cwd / process cwd. */
  cwd?: string;
  /** Agent tool id (`tb hook --tool <id>`); defaults to claude-code. */
  tool?: string;
  model?: string;
  timeoutMs?: number;
}

export async function captureAndEmit(
  params: CaptureAndEmitParams,
): Promise<SessionEvent | null> {
  const raw = JSON.parse(params.payloadJson) as {
    session_id?: string;
    cwd?: string;
  };
  const ctx = buildHookContext({
    cwd: params.cwd ?? raw.cwd ?? process.cwd(),
    sid: raw.session_id ?? 'unknown',
    ...(params.tool === undefined ? {} : { tool: params.tool }),
    ...(params.model === undefined ? {} : { model: params.model }),
  });

  // Non-default tools route through their registered adapter's mapper (its
  // payload taxonomy may differ); the claude-code default keeps the original
  // processHookPayload path unchanged. Time the map+redact work — the <20ms
  // NFR handler — and report it (fire-and-forget) for the doctor percentiles.
  let event: SessionEvent | null;
  const startedNs = performance.now();
  const adapter =
    params.tool !== undefined && params.tool !== 'claude-code'
      ? ADAPTERS[params.tool]
      : undefined;
  if (adapter !== undefined) {
    const mapped = adapter.mapEvent(raw, ctx);
    event =
      mapped === null
        ? null
        : (redactEvent(mapped, ctx.redactionLevel).event as SessionEvent);
  } else {
    event = processHookPayload(params.hookEvent, params.payloadJson, ctx).event;
  }
  const handlerMs = performance.now() - startedNs;

  if (event !== null) {
    void sendTiming(params.runtimeDir, 'hook', handlerMs, {
      ...(params.timeoutMs === undefined
        ? {}
        : { timeoutMs: params.timeoutMs }),
    });
    await emitEvent(params.runtimeDir, event, {
      ...(params.timeoutMs === undefined
        ? {}
        : { timeoutMs: params.timeoutMs }),
    });
  }
  return event;
}
