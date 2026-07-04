import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ValidationError } from '@teambrain/core';

// Loader for testdata/golden-queries.yaml (M3.4): 25 query → expected-id
// pairs over the seed-42 synthetic brain, used by `pnpm bench` for the
// recall@8 gate.

export const goldenQueriesSchema = z.object({
  seed: z.number().int(),
  count: z.number().int(),
  queries: z
    .array(
      z.object({
        key: z.string().min(1),
        query: z.string().min(1),
        expected_id: z.string().min(1),
      }),
    )
    .min(25),
});

export type GoldenQueries = z.infer<typeof goldenQueriesSchema>;

export async function loadGoldenQueries(
  filePath: string,
): Promise<GoldenQueries> {
  const fileText = await readFile(filePath, 'utf8');
  const validation = goldenQueriesSchema.safeParse(parseYaml(fileText));
  if (!validation.success) {
    throw new ValidationError(
      `invalid golden-queries fixture at ${filePath}: ${validation.error.message}`,
      { cause: validation.error },
    );
  }
  return validation.data;
}
