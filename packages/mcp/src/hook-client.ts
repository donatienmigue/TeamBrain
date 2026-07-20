import { createConnection } from 'node:net';
import type { SessionEvent } from '@teambrain/core';
import { ensureDaemon } from './ensure-daemon.js';
import { daemonSocketPath } from './paths.js';
import {
  daemonResponseSchema,
  encodeMessage,
  HOOK_EVENT_REQUEST,
  PING_REQUEST,
  SESSION_CONTEXT_REQUEST,
  TIMING_REQUEST,
  type DaemonResponse,
  type TimingMetric,
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
  options: { scope?: 'team' | 'org'; sid?: string; timeoutMs?: number } = {},
): Promise<string> {
  try {
    // Auto-start on demand (never on the sendHookEvent hot path). ensureDaemon
    // never throws; false means "still down" and the request below degrades
    // to '' exactly as it did before auto-start existed.
    if (!(await ensureDaemon({ runtimeDir }))) return '';
    const response = await requestResponse(
      daemonSocketPath(runtimeDir),
      {
        kind: SESSION_CONTEXT_REQUEST,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.sid === undefined ? {} : { sid: options.sid }),
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

/**
 * Fire-and-forget: reports an operation's duration (ms) to the daemon for the
 * `tb doctor` latency percentiles (PM §3.2). People-free (metric + duration).
 * Never rejects; a down daemon simply drops the sample.
 */
export function sendTiming(
  runtimeDir: string,
  metric: TimingMetric,
  ms: number,
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
      socket.write(encodeMessage({ kind: TIMING_REQUEST, metric, ms }), () =>
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
