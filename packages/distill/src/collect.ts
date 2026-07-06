import { readDistillWatermark } from './watermark.js';
import { gitSessionSource, type SessionSource } from './sessions.js';
import { ghPullRequestSource, type PullRequestSource } from './prs.js';
import type { PullRequest, SessionRecord } from './types.js';

// M6.1 collect: gather what a distill run should consider — new session
// records since the watermark, plus merged-PR metadata. Sources are injectable
// so the whole stage is testable without git or the network.

export interface CollectResult {
  /** Session records added since the prior watermark. */
  records: SessionRecord[];
  /** Merged PRs for commit↔path linkage. */
  prs: PullRequest[];
  /** The watermark this run started from (null on first run). */
  fromWatermark: string | null;
  /** The sessions-branch tip — the watermark to persist after a successful run. */
  nextWatermark: string | null;
}

export interface CollectOptions {
  /** Repo root holding `teambrain/sessions`. */
  repoRoot: string;
  /** Brain dir holding brain.yaml (the watermark). Defaults to `<repoRoot>/.teambrain`. */
  brainDir?: string;
  /** Override the sessions source (tests). */
  sessions?: SessionSource;
  /** Override the PR source (tests); default is the gh-backed one. */
  prs?: PullRequestSource;
}

export function collect(options: CollectOptions): CollectResult {
  const brainDir = options.brainDir ?? `${options.repoRoot}/.teambrain`;
  const sessions = options.sessions ?? gitSessionSource(options.repoRoot);
  const prSource = options.prs ?? ghPullRequestSource(options.repoRoot);

  const fromWatermark = readDistillWatermark(brainDir);
  const records = sessions.readNewRecords(fromWatermark);
  const prs = prSource.readMergedPRs();

  return {
    records,
    prs,
    fromWatermark,
    nextWatermark: sessions.head(),
  };
}
