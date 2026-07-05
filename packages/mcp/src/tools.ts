import { z } from 'zod';
import { candidateDraftSchema, type CandidateDraft, type Logger } from '@teambrain/core';
import type { Scored, SearchOptions } from '@teambrain/index';
import { buildMemoryContext, type ContextBackend, type MemoryContext } from './context.js';
import { toMemoryView, type MemoryView } from './render.js';
import { recordFeedback, writeCandidate } from './candidates.js';

// The four C3 tools as framework-agnostic handlers over a backend + spool.
// mcp-server.ts wraps these for the SDK; the SessionStart hook reuses the
// context builder directly. Inputs are zod-validated at this boundary
// (CLAUDE.md: zod on all external input; the MCP client is external).

/** C3 default k for memory_search. */
export const DEFAULT_SEARCH_K = 8;
const MAX_SEARCH_K = 50;

/** The slice of SqliteIndex the tools need (kept minimal for testability). */
export interface MemoryBackend extends ContextBackend {
  searchWithOptions(
    q: string,
    k: number,
    options?: SearchOptions,
  ): Promise<Scored[]>;
}

export interface ToolContext {
  backend: MemoryBackend;
  /** Where memory_propose queues candidates (C7 spool). */
  spoolDir: string;
  /** Where memory_feedback appends signals. */
  feedbackPath: string;
  /** Restrict retrieval to one scope; default both. */
  scope?: 'team' | 'org';
  /** Injectable clock (spool timestamps, TTL). */
  now?: () => Date;
  logger?: Logger;
}

// Input shapes as zod raw shapes so the MCP SDK can expose them directly.
export const memorySearchInput = {
  query: z.string().min(1).describe('natural-language search query'),
  k: z
    .number()
    .int()
    .positive()
    .max(MAX_SEARCH_K)
    .optional()
    .describe('max results (default 8)'),
};
export const memoryProposeInput = {
  draft: candidateDraftSchema.describe('the candidate memory to queue'),
};
export const memoryFeedbackInput = {
  id: z.string().min(1).describe('memory id the feedback is about'),
  useful: z.boolean().describe('true if the memory helped'),
};

// Type aliases (not interfaces) so they satisfy the SDK's structuredContent
// Record<string, unknown> requirement via an implicit index signature.
export type ProposeResult = {
  queued: true;
  candidate_id: string;
};
export type FeedbackResult = {
  ok: true;
};

export interface Tools {
  memoryContext(): MemoryContext;
  memorySearch(input: { query: string; k?: number }): Promise<MemoryView[]>;
  memoryPropose(input: { draft: CandidateDraft }): ProposeResult;
  memoryFeedback(input: { id: string; useful: boolean }): FeedbackResult;
}

export function createTools(context: ToolContext): Tools {
  const clock = (): Date => (context.now ? context.now() : new Date());
  return {
    memoryContext(): MemoryContext {
      return buildMemoryContext(context.backend, {
        ...(context.scope === undefined ? {} : { scope: context.scope }),
        now: clock(),
      });
    },

    async memorySearch(input): Promise<MemoryView[]> {
      const k = input.k ?? DEFAULT_SEARCH_K;
      const results = await context.backend.searchWithOptions(input.query, k, {
        ...(context.scope === undefined ? {} : { scope: context.scope }),
        now: clock(),
      });
      return results.map(toMemoryView);
    },

    memoryPropose(input): ProposeResult {
      // Re-validate: the SDK already parsed, but the hook path and other
      // callers hit this directly with untrusted drafts.
      const draft = candidateDraftSchema.parse(input.draft);
      const candidateId = writeCandidate(context.spoolDir, draft, clock());
      context.logger?.debug('candidate queued to spool', {
        candidate_id: candidateId,
        class: draft.class,
      });
      return { queued: true, candidate_id: candidateId };
    },

    memoryFeedback(input): FeedbackResult {
      recordFeedback(context.feedbackPath, input.id, input.useful, clock());
      context.logger?.debug('memory feedback recorded', {
        id: input.id,
        useful: input.useful,
      });
      return { ok: true };
    },
  };
}
