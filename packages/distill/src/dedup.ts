import { z } from 'zod';
import type { Memory } from '@teambrain/core';
import type { Provider } from './provider.js';
import type { ExistingMemory } from './brain-memories.js';
import type { DraftedCandidate } from './draft.js';

// M6.3 dedup + conflict. Embed each candidate; a cosine ≥ threshold against an
// existing memory means it's already known → drop. Otherwise, run a pairwise
// contradiction check (a Provider call) against the top-K nearest neighbors; if
// the model says the candidate contradicts an existing memory, set `supersedes`
// and flag it for the PR body (BUILD_PLAN M6.4 flag).

export const DEFAULT_SIM_THRESHOLD = 0.85;
export const DEFAULT_NEIGHBOR_K = 3;

/** Embeds each text to a vector; injected so tests stay offline. */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

/** Structured verdict for the contradiction check. */
export const conflictVerdictSchema = z.object({
  verdict: z.enum(['contradicts', 'consistent']),
  reason: z.string().default(''),
});
export type ConflictVerdict = z.infer<typeof conflictVerdictSchema>;

export interface ConflictFlag {
  /** The existing memory this candidate supersedes. */
  supersedesId: string;
  reason: string;
}

/** A candidate that survived dedup, carrying its novelty and any conflict. */
export interface DedupedCandidate extends DraftedCandidate {
  /** Max cosine similarity to any existing memory (0 when none exist). */
  maxSim: number;
  /** 1 − maxSim; the novelty factor used in scoring (M6.4). */
  novelty: number;
  /** Present when the candidate contradicts (and supersedes) an existing one. */
  conflict?: ConflictFlag;
}

/** A candidate dropped as a near-duplicate of an existing memory. */
export interface DroppedCandidate extends DraftedCandidate {
  duplicateOfId: string;
  similarity: number;
}

export interface DedupResult {
  kept: DedupedCandidate[];
  dropped: DroppedCandidate[];
}

export interface DedupOptions {
  embed: EmbedFn;
  provider: Provider;
  existing: ExistingMemory[];
  /** Cosine ≥ this drops the candidate as a duplicate. Default 0.85. */
  simThreshold?: number;
  /** How many nearest neighbors to run the contradiction check against. */
  neighborK?: number;
}

function embedText(memory: { title: string; body: string }): string {
  return `${memory.title}\n\n${memory.body}`;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const conflictSystem =
  'You compare two team memories and judge whether the NEW candidate ' +
  'directly contradicts the EXISTING memory (states a conflicting rule, ' +
  'decision, or fact). Reply "contradicts" only for a genuine conflict; a ' +
  'candidate that merely covers a different topic is "consistent".';

function renderConflictPrompt(
  candidate: Memory,
  existing: ExistingMemory,
): string {
  return [
    'CONTRADICTION CHECK',
    `EXISTING [${existing.id}]: ${existing.title}`,
    existing.body,
    '',
    `NEW CANDIDATE: ${candidate.title}`,
    candidate.body,
    '',
    'Does the NEW CANDIDATE contradict the EXISTING memory?',
  ].join('\n');
}

/**
 * Runs the dedup + conflict stage. Existing memories are embedded once; each
 * candidate is embedded, compared, and (unless dropped) conflict-checked
 * against its nearest neighbors. Deterministic given a deterministic embedder.
 */
export async function dedupCandidates(
  candidates: DraftedCandidate[],
  options: DedupOptions,
): Promise<DedupResult> {
  const threshold = options.simThreshold ?? DEFAULT_SIM_THRESHOLD;
  const neighborK = options.neighborK ?? DEFAULT_NEIGHBOR_K;
  const { existing, embed, provider } = options;

  const existingVectors =
    existing.length > 0 ? await embed(existing.map(embedText)) : [];

  const kept: DedupedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];

  for (const candidate of candidates) {
    const [vector] = await embed([embedText(candidate.memory)]);

    // Similarity to every existing memory, kept for neighbor selection.
    const sims = existing.map((memory, index) => ({
      memory,
      sim: vector === undefined ? 0 : cosine(vector, existingVectors[index]!),
    }));
    sims.sort((a, b) => b.sim - a.sim);

    const best = sims[0];
    const maxSim = best?.sim ?? 0;

    if (best !== undefined && maxSim >= threshold) {
      dropped.push({
        ...candidate,
        duplicateOfId: best.memory.id,
        similarity: maxSim,
      });
      continue;
    }

    // Not a duplicate: contradiction-check the nearest neighbors in order.
    let conflict: ConflictFlag | undefined;
    for (const neighbor of sims.slice(0, neighborK)) {
      let verdict: ConflictVerdict;
      try {
        verdict = await provider.complete({
          system: conflictSystem,
          prompt: renderConflictPrompt(candidate.memory, neighbor.memory),
          schema: conflictVerdictSchema,
          maxTokens: 256,
        });
      } catch {
        // A failed check is non-fatal: treat as no conflict (principle 2).
        continue;
      }
      if (verdict.verdict === 'contradicts') {
        conflict = { supersedesId: neighbor.memory.id, reason: verdict.reason };
        break;
      }
    }

    const memory: Memory =
      conflict === undefined
        ? candidate.memory
        : { ...candidate.memory, supersedes: [conflict.supersedesId] };

    kept.push({
      ...candidate,
      memory,
      maxSim,
      novelty: 1 - maxSim,
      ...(conflict === undefined ? {} : { conflict }),
    });
  }

  return { kept, dropped };
}
