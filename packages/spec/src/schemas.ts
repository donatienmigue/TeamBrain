import { z } from 'zod';
import { memoryFrontmatterSchema, sessionEventSchema } from '@teambrain/core';

// E6.1: the spec re-exports the SAME zod schemas the product enforces, so the
// published spec cannot diverge from the frozen contract (CONTRACTS.md is
// upstream — any divergence would be a correctness bug in both directions).
// The JSON Schema is derived, never hand-maintained.

export { memoryFrontmatterSchema, sessionEventSchema };

/** C1 memory front-matter as JSON Schema (derived from the zod schema). */
export function memoryJsonSchema(): unknown {
  return z.toJSONSchema(memoryFrontmatterSchema);
}

/** C2 session event as JSON Schema (derived from the zod schema). */
export function sessionEventJsonSchema(): unknown {
  return z.toJSONSchema(sessionEventSchema);
}
