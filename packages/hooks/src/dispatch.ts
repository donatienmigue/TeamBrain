import type { SessionEvent } from '@teambrain/core';
import { buildHookContext } from './context.js';
import { processHookPayload, type CaptureHookName } from './run.js';
import { emitEvent } from './emit.js';

// The full capture-hook body the CLI invokes: build context from the
// environment, map+redact the payload, and fire-and-forget to the daemon.
// Returns the produced event (or null) for logging/tests. Never long-running.

export interface CaptureAndEmitParams {
  hookEvent: CaptureHookName;
  payloadJson: string;
  runtimeDir: string;
  /** Working dir the session ran in; defaults to the payload cwd / process cwd. */
  cwd?: string;
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
    ...(params.model === undefined ? {} : { model: params.model }),
  });
  const { event } = processHookPayload(
    params.hookEvent,
    params.payloadJson,
    ctx,
  );
  if (event !== null) {
    await emitEvent(params.runtimeDir, event, {
      ...(params.timeoutMs === undefined
        ? {}
        : { timeoutMs: params.timeoutMs }),
    });
  }
  return event;
}
