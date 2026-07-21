import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// E6.3 (ADR-11): the adapter registry as validated data. adapters.yaml is the
// reviewable source (a community contributor adds a tool via a data PR); a test
// asserts its tool set matches the code registry so behaviour and data cannot
// drift. Config-shaped data is a config-shaped bug without a schema, so it gets
// one.

export const adapterEntrySchema = z.object({
  tool: z.string().min(1),
  /** Where the tool's MCP config lives. */
  config: z.string().min(1),
  /** How the server is registered (hooks+mcpServers, mcpServers+inference, …). */
  registration: z.string().min(1),
  /** Capture tier: T1 full, T2 inferred, T3 serve-only. */
  tier: z.enum(['T1', 'T2', 'T3']),
});
export type AdapterEntry = z.infer<typeof adapterEntrySchema>;

export const adaptersFileSchema = z.object({
  version: z.literal(1),
  adapters: z.array(adapterEntrySchema).min(1),
});
export type AdaptersFile = z.infer<typeof adaptersFileSchema>;

/** Repo-root adapters.yaml, resolved from this module (src/ or dist/). */
export function adaptersYamlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', '..', 'adapters.yaml');
}

export function loadAdapters(path: string = adaptersYamlPath()): AdaptersFile {
  return adaptersFileSchema.parse(parseYaml(readFileSync(path, 'utf8')));
}
