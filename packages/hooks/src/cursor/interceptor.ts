import { ulid, type SessionEvent, type CandidateDraft } from '@teambrain/core';
import type { HookContext } from '../map.js';
import { redactEvent } from '../redact-event.js';

export interface CursorMcpCall {
  method: string;
  args?: Record<string, unknown>;
}

/**
 * An MCP-side inference middleware for Cursor. Cursor lacks native lifecycle
 * hooks, so we intercept its MCP tool calls and infer session start/end.
 */
export class CursorInterceptor {
  private sid: string | null = null;
  private ctx: Omit<HookContext, 'sid'>;
  private turns = 0;

  constructor(ctx: Omit<HookContext, 'sid'>) {
    this.ctx = ctx;
  }

  processCall(call: CursorMcpCall): SessionEvent[] {
    const events: SessionEvent[] = [];
    this.turns += 1;
    
    if (call.method === 'memory_context') {
      if (this.sid === null) {
        this.sid = ulid();
        events.push({
          v: 1,
          sid: this.sid,
          t: this.ctx.now().toISOString(),
          tool: this.ctx.tool,
          model: this.ctx.model,
          repo: this.ctx.repo,
          branch: this.ctx.branch,
          ev: 'session_start',
          data: {}
        });
      }
    } else if (call.method === 'memory_search') {
      // Degraded capture: Cursor has no post-tool hooks, so we only get these MCP calls.
    } else if (call.method === 'memory_propose') {
      if (this.sid !== null) {
        events.push({
          v: 1,
          sid: this.sid,
          t: this.ctx.now().toISOString(),
          tool: this.ctx.tool,
          model: this.ctx.model,
          repo: this.ctx.repo,
          branch: this.ctx.branch,
          ev: 'candidate_proposed',
          data: { draft: call.args?.draft as CandidateDraft }
        });
        events.push({
          v: 1,
          sid: this.sid,
          t: this.ctx.now().toISOString(),
          tool: this.ctx.tool,
          model: this.ctx.model,
          repo: this.ctx.repo,
          branch: this.ctx.branch,
          ev: 'session_end',
          data: { 
            outcome: 'unknown', 
            duration_s: 0, 
            turns: this.turns, 
            commit_shas: [] 
          }
        });
        this.sid = null;
        this.turns = 0;
      }
    }
    
    return events.map(e => redactEvent(e, this.ctx.redactionLevel).event as SessionEvent);
  }
}

