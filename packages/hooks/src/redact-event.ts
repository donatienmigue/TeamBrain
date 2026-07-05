import { sessionEventSchema, type SessionEvent } from '@teambrain/core';
import { redactString, type RedactionLevel } from '@teambrain/redact';

// M5.2 event sanitization: the last gate before an event leaves the hook.
// Two guarantees: (1) forbidden content keys are dropped even if a future
// mapper regresses (defense in depth for the "no content|old_string|
// new_string" invariant), and (2) every surviving string leaf is redacted.

// Keys that must never carry a value into an event (raw content channels).
const FORBIDDEN_KEYS = new Set([
  'content',
  'old_string',
  'new_string',
  'command',
  'tool_response',
  'stdout',
  'stderr',
  'body',
  'prompt',
  'diff',
]);

export interface RedactedEvent {
  event: SessionEvent;
  replacements: string[];
}

function sanitize(
  value: unknown,
  level: RedactionLevel,
  replacements: string[],
): unknown {
  if (typeof value === 'string') {
    const result = redactString(value, level);
    replacements.push(...result.replacements);
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, level, replacements));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue; // never emit content channels
      out[key] = sanitize(entry, level, replacements);
    }
    return out;
  }
  return value;
}

/**
 * Redacts an event's `data` (envelope fields are metadata, left intact) and
 * re-validates the whole event against C2 — an event that no longer parses is
 * a bug worth throwing on, before it reaches the spool.
 */
export function redactEvent(
  event: SessionEvent,
  level: RedactionLevel = 'strict',
): RedactedEvent {
  const replacements: string[] = [];
  const data = sanitize(event.data, level, replacements) as SessionEvent['data'];
  const redacted = sessionEventSchema.parse({ ...event, data });
  return { event: redacted, replacements };
}
