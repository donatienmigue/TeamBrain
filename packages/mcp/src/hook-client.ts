import { createConnection } from 'node:net';
import type { SessionEvent } from '@teambrain/core';
import { daemonSocketPath } from './paths.js';
import {
  daemonResponseSchema,
  encodeMessage,
  HOOK_EVENT_REQUEST,
  PING_REQUEST,
  SESSION_CONTEXT_REQUEST,
  type DaemonResponse,
} from './protocol.js';

// Thin socket client used by hooks and `tb doctor`. Every call is bounded by
// a short timeout and degrades to a safe default (principle 2): if the daemon
// is down or slow, hooks must not block or throw to the agent.

/** Default deadline for a request/response round-trip. */
export const HOOK_CLIENT_TIMEOUT_MS = 500;

function requestResponse(
  socketPath: string,
  request: unknown,
  timeoutMs: number,
): Promise<DaemonResponse> {
  return new Promise<DaemonResponse>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.setTimeout(timeoutMs, () =>
      done(() => reject(new Error('daemon request timed out'))),
    );
    socket.on('error', (err) => done(() => reject(err)));
    socket.on('connect', () => socket.write(encodeMessage(request)));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const parsed = daemonResponseSchema.parse(
          JSON.parse(buffer.slice(0, newline)),
        );
        done(() => resolve(parsed));
      } catch (err) {
        done(() => reject(err as Error));
      }
    });
  });
}

/**
 * Asks the daemon for the SessionStart context bundle. Returns '' on any
 * failure (daemon down, timeout, error) — the hook then injects nothing,
 * which is the correct graceful-degradation behavior.
 */
export async function requestSessionContext(
  runtimeDir: string,
  options: { scope?: 'team' | 'org'; timeoutMs?: number } = {},
): Promise<string> {
  try {
    const response = await requestResponse(
      daemonSocketPath(runtimeDir),
      {
        kind: SESSION_CONTEXT_REQUEST,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
      },
      options.timeoutMs ?? HOOK_CLIENT_TIMEOUT_MS,
    );
    return response.kind === 'session_context_result' ? response.bundle : '';
  } catch {
    return '';
  }
}

/**
 * Fire-and-forget: sends a session event to the daemon and resolves once it
 * is on the wire (or immediately on failure). Never rejects.
 */
export function sendHookEvent(
  runtimeDir: string,
  event: SessionEvent,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  return new Promise<void>((resolve) => {
    const socket = createConnection(daemonSocketPath(runtimeDir));
    const finish = (): void => {
      socket.destroy();
      resolve();
    };
    socket.setTimeout(options.timeoutMs ?? HOOK_CLIENT_TIMEOUT_MS, finish);
    socket.on('error', finish);
    socket.on('connect', () => {
      socket.write(encodeMessage({ kind: HOOK_EVENT_REQUEST, event }), () =>
        finish(),
      );
    });
  });
}

/** Liveness probe for `tb doctor`. Returns the pong or null if unreachable. */
export async function pingDaemon(
  runtimeDir: string,
  timeoutMs: number = HOOK_CLIENT_TIMEOUT_MS,
): Promise<{ pid: number; doc_count: number } | null> {
  try {
    const response = await requestResponse(
      daemonSocketPath(runtimeDir),
      { kind: PING_REQUEST },
      timeoutMs,
    );
    return response.kind === 'pong'
      ? { pid: response.pid, doc_count: response.doc_count }
      : null;
  } catch {
    return null;
  }
}
