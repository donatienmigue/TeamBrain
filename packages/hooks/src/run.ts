import type { SessionEvent } from '@teambrain/core';
import {
  mapPostToolUse,
  mapSessionEnd,
  mapSessionStart,
  type HookContext,
} from './map.js';
import {
  postToolUsePayloadSchema,
  sessionEndPayloadSchema,
  sessionStartPayloadSchema,
} from './payloads.js';
import { redactEvent } from './redact-event.js';

// The measured hook handler (M5.2): parse → map → redact. Pure and fast (the
// <20ms p95 budget applies here); emitting to the socket is a separate
// fire-and-forget step so the handler cost excludes network.

export type CaptureHookName =
  'PostToolUse' | 'SessionStart' | 'Stop' | 'SessionEnd';

export interface ProcessedHook {
  event: SessionEvent | null;
  replacements: string[];
}

export function processHookPayload(
  hookEvent: CaptureHookName,
  payloadJson: string,
  ctx: HookContext,
): ProcessedHook {
  const raw: unknown = JSON.parse(payloadJson);
  let event: SessionEvent | null;
  switch (hookEvent) {
    case 'PostToolUse':
      event = mapPostToolUse(postToolUsePayloadSchema.parse(raw), ctx);
      break;
    case 'SessionStart':
      event = mapSessionStart(sessionStartPayloadSchema.parse(raw), ctx);
      break;
    case 'Stop':
    case 'SessionEnd':
      event = mapSessionEnd(sessionEndPayloadSchema.parse(raw), ctx);
      break;
  }
  if (event === null) return { event: null, replacements: [] };
  return redactEvent(event, ctx.redactionLevel);
}
