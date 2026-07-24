import { z } from 'zod';
import {
  candidateDraftSchema,
  type CandidateDraft,
  type Evidence,
  type Logger,
} from '@teambrain/core';
import { redactString, type RedactionLevel } from '@teambrain/redact';
import type { Scored, SearchOptions } from '@teambrain/index';
import {
  buildMemoryContext,
  type ContextBackend,
  type MemoryContext,
} from './context.js';
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
  /** Optional interceptor for capturing tool usage (e.g., Cursor MCP-side inference). */
  onToolCall?: (name: string, args?: Record<string, unknown>) => void;
  /**
   * A2: resolves the current session's evidence for an agent proposal, so an
   * agent draft that carries none is stamped with the live session — closing
   * the asymmetry with `tb propose`. Injectable so the golden tests stay
   * offline; the daemon/MCP entry wires it to the live sid. Returns
   * `undefined` when no session is resolvable, mirroring `tb propose`'s
   * null-sid path (evidence left unset).
   */
  resolveEvidence?: () => Evidence | undefined;
  /**
   * A3 (load-bearing): emit the proposal as a C2 `candidate_proposed` event
   * into the active session's JSONL, so it reaches the CI distiller on
   * `session_end` (C7: the local candidate spool is never synced). Injectable
   * so the golden tests stay offline; the daemon-connected MCP entry wires it
   * to `sendHookEvent`. Undefined on the mcp-inference path (Cursor), where the
   * interceptor already emits the event — so this never double-emits. The draft
   * passed here is already redacted.
   */
  emitCandidateProposed?: (draft: CandidateDraft) => void;
  /**
   * Redaction level for the propose path (A3). Defaults to `strict` — the
   * fail-safe (more redaction), matching the hook default. The runtime wires
   * the brain.yaml level.
   */
  redactionLevel?: RedactionLevel;
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
  /**
   * R16.1 (P1): `paths` carries the caller's session scoping signal for the
   * codemap slice (see buildMemoryContext). The C3 tool surface is unchanged
   * — the MCP tool still takes no input; only in-process callers (the
   * daemon, which knows the session) pass paths.
   */
  memoryContext(options?: { paths?: string[] }): MemoryContext;
  memorySearch(input: { query: string; k?: number }): Promise<MemoryView[]>;
  memoryPropose(input: { draft: CandidateDraft }): ProposeResult;
  memoryFeedback(input: { id: string; useful: boolean }): FeedbackResult;
}

export function createTools(context: ToolContext): Tools {
  const clock = (): Date => (context.now ? context.now() : new Date());
  return {
    memoryContext(options?: { paths?: string[] }): MemoryContext {
      context.onToolCall?.('memory_context');
      return buildMemoryContext(context.backend, {
        ...(context.scope === undefined ? {} : { scope: context.scope }),
        now: clock(),
        ...(options?.paths === undefined ? {} : { paths: options.paths }),
      });
    },

    async memorySearch(input): Promise<MemoryView[]> {
      context.onToolCall?.('memory_search', input);
      const k = input.k ?? DEFAULT_SEARCH_K;
      const results = await context.backend.searchWithOptions(input.query, k, {
        ...(context.scope === undefined ? {} : { scope: context.scope }),
        now: clock(),
      });
      return results.map(toMemoryView);
    },

    memoryPropose(input): ProposeResult {
      context.onToolCall?.('memory_propose', input);
      // Re-validate: the SDK already parsed, but the hook path and other
      // callers hit this directly with untrusted drafts.
      let draft = candidateDraftSchema.parse(input.draft);
      // A2: the agent is *in* the session, so stamp its evidence when the
      // draft carries none — same linkage `tb propose` sets for the human
      // path. Null-safe: no resolver / no session → leave evidence unset, then
      // re-validate the enriched draft (the handler re-parses untrusted input).
      if ((draft as { evidence?: unknown }).evidence === undefined) {
        const evidence = context.resolveEvidence?.();
        if (evidence !== undefined) {
          draft = candidateDraftSchema.parse({ ...draft, evidence });
        }
      }
      // A3 privacy: the draft is agent-authored prose composed from what the
      // agent saw in-session, so unlike tool_use metadata it *could* echo a
      // secret. Run title + body through the same redactor before it is
      // spooled OR emitted — the one content-leak path around "metadata by
      // default, never content" (principle 3). Re-validate so both sinks and
      // the C2 event see a contract-valid draft.
      const level = context.redactionLevel ?? 'strict';
      const title = redactString(draft.title, level).text;
      const body = redactString(draft.body, level).text;
      if (title !== draft.title || body !== draft.body) {
        draft = candidateDraftSchema.parse({ ...draft, title, body });
      }
      const candidateId = writeCandidate(context.spoolDir, draft, clock());
      // A3 transport: also emit the C2 event so the proposal actually reaches
      // CI. Best-effort (principle 2): a failed emit still leaves the local
      // spool copy for `tb audit` / `tb propose` parity.
      context.emitCandidateProposed?.(draft);
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
