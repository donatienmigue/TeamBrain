import { z } from 'zod';

// The slices of Claude Code's hook stdin payloads we consume (M5.2). Loose
// objects: Claude Code may add fields and we must survive that. We read only
// what maps to C2 shape — and deliberately never read content fields
// (old_string/new_string/tool_response bodies) into events.

export const postToolUsePayloadSchema = z.looseObject({
  hook_event_name: z.literal('PostToolUse').optional(),
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  tool_name: z.string(),
  tool_input: z.looseObject({}).optional(),
  tool_response: z.looseObject({}).optional(),
});
export type PostToolUsePayload = z.infer<typeof postToolUsePayloadSchema>;

export const sessionStartPayloadSchema = z.looseObject({
  hook_event_name: z.literal('SessionStart').optional(),
  session_id: z.string().optional(),
  source: z.string().optional(),
});
export type SessionStartPayload = z.infer<typeof sessionStartPayloadSchema>;

export const sessionEndPayloadSchema = z.looseObject({
  hook_event_name: z.enum(['Stop', 'SessionEnd']).optional(),
  session_id: z.string().optional(),
  reason: z.string().optional(),
});
export type SessionEndPayload = z.infer<typeof sessionEndPayloadSchema>;
