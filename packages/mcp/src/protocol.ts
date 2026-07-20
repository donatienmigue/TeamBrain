import { z } from 'zod';
import { sessionEventSchema } from '@teambrain/core';

// Newline-delimited JSON over the daemon's local socket (M4.1). One request
// per connection. Hook events are fire-and-forget (no response); the
// session_context request returns the injectable bundle; ping is a liveness
// probe. All payloads are zod-validated on receipt (CLAUDE.md boundary rule).

export const HOOK_EVENT_REQUEST = 'hook_event';
export const SESSION_CONTEXT_REQUEST = 'session_context';
export const PING_REQUEST = 'ping';

export const daemonRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(HOOK_EVENT_REQUEST), event: sessionEventSchema }),
  z.object({
    kind: z.literal(SESSION_CONTEXT_REQUEST),
    scope: z.enum(['team', 'org']).optional(),
    // R16.1 T7b: the session id, when the caller knows it (the SessionStart
    // hook does). Drives the codemap control-arm bypass; absent → treatment.
    sid: z.string().optional(),
  }),
  z.object({ kind: z.literal(PING_REQUEST) }),
]);
export type DaemonRequest = z.infer<typeof daemonRequestSchema>;

export const sessionContextResultSchema = z.object({
  kind: z.literal('session_context_result'),
  bundle: z.string(),
});
export const pongResultSchema = z.object({
  kind: z.literal('pong'),
  pid: z.number(),
  doc_count: z.number(),
});
export const errorResultSchema = z.object({
  kind: z.literal('error'),
  message: z.string(),
});

export const daemonResponseSchema = z.discriminatedUnion('kind', [
  sessionContextResultSchema,
  pongResultSchema,
  errorResultSchema,
]);
export type DaemonResponse = z.infer<typeof daemonResponseSchema>;

export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
