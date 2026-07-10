import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { formatZodIssues } from './zod-issues.js';
import { ValidationError } from './errors.js';

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
  // R16 CodeMap (Tech Brief §4.8), off by default. Enabling makes the daemon
  // index .teambrain/codemap/ under C4's reserved source and tb distill
  // --codemap maintain it.
  codemap: z
    .looseObject({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
});
export type BrainConfig = z.infer<typeof brainConfigSchema>;

export class BrainConfigParseError extends ValidationError {
  override readonly name = 'BrainConfigParseError';
}

export function parseBrainConfig(yamlText: string): BrainConfig {
  let yamlData: unknown;
  try {
    yamlData = parseYaml(yamlText);
  } catch (err) {
    throw new BrainConfigParseError(`invalid YAML: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const validation = brainConfigSchema.safeParse(yamlData);
  if (!validation.success) {
    throw new BrainConfigParseError(
      `invalid brain.yaml: ${formatZodIssues(validation.error)}`,
      { cause: validation.error },
    );
  }
  return validation.data;
}
