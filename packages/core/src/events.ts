import { z } from 'zod';
import { memoryClassSchema } from './memory.js';

// C2 join keys, present on every event (FlightDeck design-ahead).
const envelope = {
  v: z.literal(1),
  sid: z.string().min(1),
  t: z.iso.datetime({ offset: true }),
  tool: z.string().min(1),
  model: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
};

// C2 is "additive evolution only": data payloads are loose (unknown keys
// pass through) so a v1 reader survives newer writers.
export const candidateDraftSchema = z.looseObject({
  class: memoryClassSchema,
  title: z.string().min(1).max(80),
  body: z.string().min(1),
  tags: z.array(z.string()).optional(),
});
export type CandidateDraft = z.infer<typeof candidateDraftSchema>;

export const sessionEventSchema = z.discriminatedUnion('ev', [
  z.object({
    ...envelope,
    ev: z.literal('session_start'),
    data: z.looseObject({}),
  }),
  z.object({
    ...envelope,
    ev: z.literal('intent'),
    // Locally-summarized, never the raw prompt (C2).
    data: z.looseObject({ summary: z.string().max(200) }),
  }),
  z.object({
    ...envelope,
    ev: z.literal('memory_retrieved'),
    data: z.looseObject({ ids: z.array(z.string()) }),
  }),
  z.object({
    ...envelope,
    ev: z.literal('tool_use'),
    data: z.looseObject({
      kind: z.enum(['edit', 'command', 'test']),
      path: z.string().optional(),
      exit_code: z.number().int().optional(),
    }),
  }),
  z.object({
    ...envelope,
    ev: z.literal('plan_revision'),
    data: z.looseObject({}),
  }),
  z.object({
    ...envelope,
    ev: z.literal('candidate_proposed'),
    data: z.looseObject({ draft: candidateDraftSchema }),
  }),
  z.object({
    ...envelope,
    ev: z.literal('session_end'),
    data: z.looseObject({
      outcome: z.enum(['committed', 'abandoned', 'unknown']),
      duration_s: z.number().nonnegative(),
      turns: z.number().int().nonnegative(),
      commit_shas: z.array(z.string()),
    }),
  }),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export class SessionEventParseError extends Error {
  override readonly name = 'SessionEventParseError';
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function parseSessionEventLine(line: string): SessionEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (err) {
    throw new SessionEventParseError(
      `invalid JSON: ${(err as Error).message}`,
      { cause: err },
    );
  }
  const result = sessionEventSchema.safeParse(raw);
  if (!result.success) {
    throw new SessionEventParseError(
      `invalid session event: ${formatIssues(result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  return result.data;
}

export function serializeSessionEvent(event: SessionEvent): string {
  return JSON.stringify(sessionEventSchema.parse(event));
}
