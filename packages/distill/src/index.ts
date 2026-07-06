export {
  DEFAULT_CLUSTER_OPTIONS,
  type SessionRecord,
  type PullRequest,
  type Cluster,
  type ClusterKind,
  type ClusterOptions,
} from './types.js';
export { readDistillWatermark, writeDistillWatermark } from './watermark.js';
export {
  gitSessionSource,
  SESSIONS_BRANCH,
  type SessionSource,
} from './sessions.js';
export {
  ghPullRequestSource,
  type PullRequestSource,
  type ExecFn,
} from './prs.js';
export { clusterSignals } from './cluster.js';
export { collect, type CollectResult, type CollectOptions } from './collect.js';
export type { Provider, ProviderRequest } from './provider.js';
export {
  fakeProvider,
  fixtureResponder,
  type FakeResponder,
  type FakeRequestView,
  type FakeFixture,
} from './fake-provider.js';
export {
  anthropicProvider,
  DEFAULT_DISTILL_MODEL,
  type AnthropicProviderOptions,
} from './anthropic.js';
export {
  draftCandidates,
  loadDistillPrompt,
  renderClusterPrompt,
  draftOutputSchema,
  type DraftOutput,
  type DraftedCandidate,
  type DraftResult,
  type DraftOptions,
} from './draft.js';
export { loadExistingMemories, type ExistingMemory } from './brain-memories.js';
export {
  dedupCandidates,
  conflictVerdictSchema,
  DEFAULT_SIM_THRESHOLD,
  DEFAULT_NEIGHBOR_K,
  type EmbedFn,
  type ConflictVerdict,
  type ConflictFlag,
  type DedupedCandidate,
  type DroppedCandidate,
  type DedupResult,
  type DedupOptions,
} from './dedup.js';
export {
  gateCandidates,
  renderPrBody,
  DEFAULT_MAX_PROPOSALS,
  type Proposal,
} from './gate.js';
export { distill, type DistillInput, type DistillOutcome } from './pipeline.js';
