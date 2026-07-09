import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { memoryClassSchema, ulid, type Memory } from '@teambrain/core';
import type { Provider } from './provider.js';
import type { Cluster } from './types.js';

// M6.2 draft: one Provider call per cluster, using the versioned prompt
// `prompts/distill-v1.md`, producing a zod-validated C1 candidate with evidence
// populated from the cluster. Invalid model output (a rejected Provider call)
// is discarded and counted (BUILD_PLAN M6.2).

// The distiller only fills class/title/body/tags; every other C1 field is
// deterministic here (advisory, active, team scope, evidence from the cluster,
// no supersedes yet — M6.3 may add one). Structured-output-friendly: the SDK
// strips min/max constraints the model can't enforce and validates them
// client-side, so keeping them here is safe and still gates fake output.
export const draftOutputSchema = z.object({
  class: memoryClassSchema,
  title: z.string().min(1).max(80),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

/** A drafted candidate: the full C1 memory plus the cluster it came from. */
export interface DraftedCandidate {
  memory: Memory;
  cluster: Cluster;
}

export interface DraftResult {
  candidates: DraftedCandidate[];
  /** Clusters whose Provider call produced unusable output. */
  discarded: number;
}

import type { FlywheelExamples } from './flywheel.js';

export interface DraftOptions {
  /** Injectable clock; the candidate's `created` date. Default now. */
  now?: Date;
  /** Injectable id source (tests want deterministic ids). Default ulid(). */
  newId?: () => string;
  /** Override the system prompt (tests); default is `prompts/distill-v1.md`. */
  systemPrompt?: string;
  /** Few-shot calibration examples. */
  flywheel?: FlywheelExamples;
}

let cachedSystemPrompt: string | undefined;

/** Loads the versioned distiller prompt, packaged beside the built code. */
export function loadDistillPrompt(): string {
  if (cachedSystemPrompt === undefined) {
    const promptPath = fileURLToPath(
      new URL('../prompts/distill-v1.md', import.meta.url),
    );
    cachedSystemPrompt = readFileSync(promptPath, 'utf8');
  }
  return cachedSystemPrompt;
}

export function renderFlywheelPrompt(flywheel?: FlywheelExamples): string {
  if (!flywheel) return '';
  if (flywheel.accepted.length === 0 && flywheel.rejected.length === 0) return '';
  
  const lines: string[] = ['', '## Per-team calibration'];
  
  if (flywheel.accepted.length > 0) {
    lines.push('', 'The following are titles of recently ACCEPTED memories by this team (use as good examples):');
    for (const t of flywheel.accepted) lines.push(`- ${t}`);
  }
  
  if (flywheel.rejected.length > 0) {
    lines.push('', 'The following are titles of recently REJECTED memories by this team (do NOT propose these):');
    for (const t of flywheel.rejected) lines.push(`- ${t}`);
  }
  
  return lines.join('\n');
}

/**
 * Renders a cluster into the user prompt: a stable, metadata-only description
 * of the signal. Deterministic so the golden pipeline test is reproducible.
 */
export function renderClusterPrompt(cluster: Cluster): string {
  const lines = [
    `SIGNAL: ${cluster.kind}`,
    `KEY: ${cluster.key}`,
    `STRENGTH: ${cluster.strength}`,
    `DISTINCT_SESSIONS: ${cluster.sessions.length}`,
    `COMMITS: ${cluster.commits.length}`,
    `DETAIL: ${JSON.stringify(cluster.detail)}`,
    '',
    'Propose one memory (class, title, body, tags) justified by this signal.',
  ];
  return lines.join('\n');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Drafts one candidate per cluster; unusable Provider output is discarded. */
export async function draftCandidates(
  clusters: Cluster[],
  provider: Provider,
  options: DraftOptions = {},
): Promise<DraftResult> {
  const baseSystem = options.systemPrompt ?? loadDistillPrompt();
  const system = baseSystem + renderFlywheelPrompt(options.flywheel);
  const created = isoDate(options.now ?? new Date());
  const newId = options.newId ?? ulid;

  const candidates: DraftedCandidate[] = [];
  let discarded = 0;

  for (const cluster of clusters) {
    let output: DraftOutput;
    try {
      output = await provider.complete({
        system,
        prompt: renderClusterPrompt(cluster),
        schema: draftOutputSchema,
        maxTokens: 1024,
      });
    } catch {
      // Refusal, malformed output, or schema-invalid → discard + count.
      // (Degradation is expected here, not an error — principle 2.)
      discarded += 1;
      continue;
    }

    const memory: Memory = {
      id: newId(),
      class: output.class,
      scope: 'team',
      status: 'active',
      priority: 'advisory',
      title: output.title,
      created,
      evidence: { sessions: cluster.sessions, commits: cluster.commits },
      supersedes: [],
      tags: output.tags,
      ttl_days: null,
      body: output.body,
    };
    candidates.push({ memory, cluster });
  }

  return { candidates, discarded };
}
