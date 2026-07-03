import { z } from 'zod';
import { ULID_REGEX } from './ulid.js';
import { slugify } from './slug.js';

export const ulidSchema = z.string().regex(ULID_REGEX, 'must be a ULID');

export const MEMORY_CLASSES = [
  'decision',
  'convention',
  'map',
  'learning',
] as const;
export const memoryClassSchema = z.enum(MEMORY_CLASSES);
export type MemoryClass = z.infer<typeof memoryClassSchema>;

function isValidCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
  .refine(isValidCalendarDate, 'must be a real calendar date');

export const evidenceSchema = z.strictObject({
  sessions: z.array(z.string()),
  commits: z.array(z.string()),
});
export type Evidence = z.infer<typeof evidenceSchema>;

// C1 front-matter. Strict: unknown keys are contract violations, not
// additive evolution (C2's additive rule covers events, not memory files).
export const memoryFrontmatterSchema = z.strictObject({
  id: ulidSchema,
  class: memoryClassSchema,
  scope: z.enum(['team', 'org']),
  status: z.enum(['active', 'retired']),
  priority: z.enum(['required', 'advisory']),
  title: z.string().min(1).max(80),
  created: isoDateSchema,
  // Optional here; "mandatory when proposer=distiller" is enforced by
  // `tb lint` (M1.2) since C1 carries no proposer field to key off.
  evidence: evidenceSchema.optional(),
  supersedes: z.array(ulidSchema),
  tags: z.array(z.string()),
  ttl_days: z.number().int().nullable(),
});
export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

export type Memory = MemoryFrontmatter & { body: string };

// C1 path segment per memory class: memories/<directory>/<id>-<slug>.md
export const MEMORY_CLASS_DIRECTORIES: Record<MemoryClass, string> = {
  decision: 'decisions',
  convention: 'conventions',
  map: 'map',
  learning: 'learnings',
};

export function memoryPath(
  frontmatter: Pick<MemoryFrontmatter, 'id' | 'class' | 'title'>,
): string {
  return `memories/${MEMORY_CLASS_DIRECTORIES[frontmatter.class]}/${frontmatter.id}-${slugify(frontmatter.title)}.md`;
}
