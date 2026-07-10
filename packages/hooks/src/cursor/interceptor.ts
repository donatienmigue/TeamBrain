import { ulid, type SessionEvent, type CandidateDraft } from '@teambrain/core';
import type { HookContext } from '../map.js';
import { redactEvent } from '../redact-event.js';

export interface CursorMcpCall {
  method: string;
  args?: Record<string, unknown>;
}

/**
 * Idle gap after which an open Cursor session is considered over. Cursor has
 * no lifecycle hooks, so without this a session that never proposes a memory
 * would never emit session_end.
 */
export const CURSOR_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface CursorInterceptorOptions {
  idleTimeoutMs?: number;
}

/**
 * An MCP-side inference middleware for Cursor. Cursor lacks native lifecycle
 * hooks, so we intercept its MCP tool calls and infer session start/end.
 * A session ends when it proposes a memory or when it has been idle past
 * `idleTimeoutMs` — expiry is detected lazily on the next call, or eagerly
 * via {@link flushIdle} (the daemon wires that to a timer).
 */
export class CursorInterceptor {
  private sid: string | null = null;
  private ctx: Omit<HookContext, 'sid'>;
  private turns = 0;
  private startedAtMs = 0;
  private lastActivityMs = 0;
  private readonly idleTimeoutMs: number;

  constructor(
    ctx: Omit<HookContext, 'sid'>,
    options: CursorInterceptorOptions = {},
  ) {
    this.ctx = ctx;
    this.idleTimeoutMs = options.idleTimeoutMs ?? CURSOR_IDLE_TIMEOUT_MS;
  }

  processCall(call: CursorMcpCall): SessionEvent[] {
    const now = this.ctx.now();
    // A stale session ends before the incoming call is interpreted, so a
    // return-from-lunch memory_context starts a fresh session, not turn N+1.
    const events: SessionEvent[] = this.endIfIdle(now);

    if (this.sid !== null) {
      this.turns += 1;
      this.lastActivityMs = now.getTime();
    }

    if (call.method === 'memory_context') {
      if (this.sid === null) {
        this.sid = ulid();
        this.turns = 1;
        this.startedAtMs = now.getTime();
        this.lastActivityMs = now.getTime();
        events.push(this.event(now, 'session_start', {}));
      }
    } else if (call.method === 'memory_search') {
      // Degraded capture: Cursor has no post-tool hooks, so we only get these MCP calls.
    } else if (call.method === 'memory_propose') {
      if (this.sid !== null) {
        events.push(
          this.event(now, 'candidate_proposed', {
            draft: call.args?.draft as CandidateDraft,
          }),
        );
        events.push(this.sessionEnd(now, now.getTime()));
      }
    }

    return events.map(
      (e) => redactEvent(e, this.ctx.redactionLevel).event as SessionEvent,
    );
  }

  /**
   * Ends the open session if it has been idle past the timeout. The daemon
   * calls this from a timer so sessions that never propose (and never see
   * another MCP call) still emit session_end.
   */
  flushIdle(): SessionEvent[] {
    return this.endIfIdle(this.ctx.now()).map(
      (e) => redactEvent(e, this.ctx.redactionLevel).event as SessionEvent,
    );
  }

  private endIfIdle(now: Date): SessionEvent[] {
    if (
      this.sid === null ||
      now.getTime() - this.lastActivityMs < this.idleTimeoutMs
    ) {
      return [];
    }
    // The session was over at its last activity, not when we noticed.
    return [this.sessionEnd(now, this.lastActivityMs)];
  }

  private sessionEnd(now: Date, endedAtMs: number): SessionEvent {
    const event = this.event(now, 'session_end', {
      outcome: 'unknown',
      duration_s: Math.max(
        0,
        Math.round((endedAtMs - this.startedAtMs) / 1000),
      ),
      turns: this.turns,
      commit_shas: [],
    });
    this.sid = null;
    this.turns = 0;
    return event;
  }

  private event(
    now: Date,
    ev: SessionEvent['ev'],
    data: SessionEvent['data'],
  ): SessionEvent {
    return {
      v: 1,
      sid: this.sid as string,
      t: now.toISOString(),
      tool: this.ctx.tool,
      model: this.ctx.model,
      repo: this.ctx.repo,
      branch: this.ctx.branch,
      ev,
      data,
    } as SessionEvent;
  }
}
