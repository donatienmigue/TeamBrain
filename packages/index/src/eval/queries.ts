import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ValidationError } from '@teambrain/core';

// Loader for testdata/eval/queries.yaml (R10): human/agent-perspective
// queries over the real eval corpus. `relevant: []` marks a negative —
// the correct retrieval answer is "nothing".

export const evalQuerySchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  relevant: z.array(z.string()),
  kind: z.enum(['structural', 'decision', 'convention', 'gotcha', 'negative']),
  written_by: z.string().min(1),
});
export type EvalQuery = z.infer<typeof evalQuerySchema>;

export const evalQueryFileSchema = z.object({
  queries: z.array(evalQuerySchema).min(1),
});

export async function loadEvalQueries(path: string): Promise<EvalQuery[]> {
  const parsed = evalQueryFileSchema.safeParse(
    parseYaml(await readFile(path, 'utf8')),
  );
  if (!parsed.success) {
    throw new ValidationError(
      `invalid eval query file ${path}: ${parsed.error.message}`,
    );
  }
  const queries = parsed.data.queries;
  const ids = new Set<string>();
  for (const query of queries) {
    if (ids.has(query.id)) {
      throw new ValidationError(`duplicate eval query id: ${query.id}`);
    }
    ids.add(query.id);
    // A negative must be marked as such and vice versa — an unmarked empty
    // `relevant` is almost certainly an authoring mistake.
    if ((query.kind === 'negative') !== (query.relevant.length === 0)) {
      throw new ValidationError(
        `eval query ${query.id}: kind '${query.kind}' inconsistent with ` +
          `${query.relevant.length} relevant id(s)`,
      );
    }
  }
  return queries;
}
