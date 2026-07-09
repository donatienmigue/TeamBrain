import { collect, type CollectOptions } from './collect.js';
import { clusterSignals } from './cluster.js';
import { DEFAULT_CLUSTER_OPTIONS, type ClusterOptions } from './types.js';
import { draftCandidates } from './draft.js';
import { loadExistingMemories, type ExistingMemory } from './brain-memories.js';
import {
  dedupCandidates,
  DEFAULT_NEIGHBOR_K,
  DEFAULT_SIM_THRESHOLD,
  type EmbedFn,
} from './dedup.js';
import { gateCandidates, renderPrBody, DEFAULT_MAX_PROPOSALS } from './gate.js';
import { deriveFlywheelExamples } from './flywheel.js';
import type { Provider } from './provider.js';
import type { Proposal } from './gate.js';

// M6.4 pipeline: the full distill run wired end to end — collect → cluster →
// draft → dedup → gate → PR body. Pure of git side effects (the CLI does the
// branch write + `gh pr create`); this is what both `tb distill --dry-run` and
// the golden pipeline test exercise. Sources, Provider, and embedder are all
// injectable so the test runs offline against fixtures.

export interface DistillInput extends CollectOptions {
  provider: Provider;
  embed: EmbedFn;
  /** Existing memories to dedup against; loaded from `brainDir` when omitted. */
  existing?: ExistingMemory[];
  clusterOptions?: ClusterOptions;
  simThreshold?: number;
  neighborK?: number;
  maxProposals?: number;
  /** Injectable clock + id source for deterministic drafts (tests). */
  now?: Date;
  newId?: () => string;
  systemPrompt?: string;
}

export interface DistillOutcome {
  proposals: Proposal[];
  prBody: string;
  /** Counts for the run summary / audit. */
  clusters: number;
  discardedDrafts: number;
  droppedDuplicates: number;
  /** Watermark bookkeeping from collect (the CLI advances it on a real run). */
  fromWatermark: string | null;
  nextWatermark: string | null;
}

/** Runs the full distill pipeline, returning proposals + the PR body. */
export async function distill(input: DistillInput): Promise<DistillOutcome> {
  const brainDir = input.brainDir ?? `${input.repoRoot}/.teambrain`;

  const collected = collect(input);
  const clusters = clusterSignals(
    collected.records,
    collected.prs,
    input.clusterOptions ?? DEFAULT_CLUSTER_OPTIONS,
  );

  const existing = input.existing ?? loadExistingMemories(brainDir);

  const prBodies = input.prs ? (input.prs.readTeamBrainPRBodies?.() ?? []) : [];
  const flywheel = deriveFlywheelExamples(prBodies, existing);

  const drafted = await draftCandidates(clusters, input.provider, {
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.newId === undefined ? {} : { newId: input.newId }),
    ...(input.systemPrompt === undefined
      ? {}
      : { systemPrompt: input.systemPrompt }),
    flywheel,
  });

  const deduped = await dedupCandidates(drafted.candidates, {
    embed: input.embed,
    provider: input.provider,
    existing,
    simThreshold: input.simThreshold ?? DEFAULT_SIM_THRESHOLD,
    neighborK: input.neighborK ?? DEFAULT_NEIGHBOR_K,
  });

  const proposals = gateCandidates(
    deduped.kept,
    input.maxProposals ?? DEFAULT_MAX_PROPOSALS,
  );

  return {
    proposals,
    prBody: renderPrBody(proposals),
    clusters: clusters.length,
    discardedDrafts: drafted.discarded,
    droppedDuplicates: deduped.dropped.length,
    fromWatermark: collected.fromWatermark,
    nextWatermark: collected.nextWatermark,
  };
}
