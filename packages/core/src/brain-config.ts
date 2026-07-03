import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

// brain.yaml (C7). Field set is not contract-frozen beyond what C7/the tech
// brief name (scopes, required-tag rules, model pins, redaction level), so
// the schema is minimal and loose: unknown keys pass through untouched to
// stay additive-friendly (e.g. the M6 distiller state block).
export const brainConfigSchema = z.looseObject({
  version: z.literal(1),
  capture: z
    .looseObject({
      level: z.enum(['metadata', 'full']).default('metadata'),
    })
    .default({ level: 'metadata' }),
  redaction: z
    .looseObject({
      level: z.enum(['strict', 'standard']).default('strict'),
    })
    .default({ level: 'strict' }),
  distill: z
    .looseObject({
      model: z.string().min(1),
    })
    .optional(),
  required_tags: z.array(z.string()).default([]),
});
export type BrainConfig = z.infer<typeof brainConfigSchema>;

export class BrainConfigParseError extends Error {
  override readonly name = 'BrainConfigParseError';
}

export function parseBrainConfig(yamlText: string): BrainConfig {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new BrainConfigParseError(`invalid YAML: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const result = brainConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new BrainConfigParseError(`invalid brain.yaml: ${issues}`, {
      cause: result.error,
    });
  }
  return result.data;
}
