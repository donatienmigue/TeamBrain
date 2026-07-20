import { execFile } from 'node:child_process';
import {
  existsSync,
  rmSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { basename, dirname, join } from 'node:path';
import type { Logger, SessionEvent } from '@teambrain/core';
import {
  syncIndexWithBrain,
  type Embedder,
  type SqliteIndex,
} from '@teambrain/index';
import { openBackend } from './runtime.js';
import {
  renderContextBundle,
  SESSION_CONTEXT_MAX_CHARS,
  type MemoryContext,
} from './context.js';
import { bundleTokens } from './render.js';
import { servesCodemap } from './codemap-arm-serving.js';
import { createTools, type Tools } from './tools.js';
import { Spool } from './spool.js';
import { SessionPathTracker } from './session-paths.js';
import {
  daemonRequestSchema,
  encodeMessage,
  type DaemonResponse,
} from './protocol.js';
import { daemonSocketPath, heartbeatPath, pidFilePath } from './paths.js';

// M4.1 daemon: long-lived process that keeps the index fresh and serves hook
// events + context requests over a local socket. Principle 1 governs every
// choice here — the index is a rebuildable cache, so a poll-based checksum
// reindex (reliable on every OS, unlike recursive fs.watch) is the source of
// truth for "the brain changed", with fs.watch only a best-effort nudge.

const DEFAULT_WATCH_INTERVAL_MS = 1500;
const DEFAULT_GIT_FETCH_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

export interface StartDaemonOptions {
  /** Machine-local runtime dir (C7): index.db, socket, pidfile, heartbeat. */
  runtimeDir: string;
  /** The repo brain dir (`.teambrain/`) to watch and index. */
  brainDir: string;
  scope?: 'team' | 'org';
  /** Checksum poll interval (the "watcher cycle"); default 1500ms. */
  watchIntervalMs?: number;
  /** `git fetch` cadence on the brain repo; default 60s. */
  gitFetchIntervalMs?: number;
  /** Heartbeat write cadence; default 5s. */
  heartbeatIntervalMs?: number;
  logger?: Logger;
  /** Inject an embedder, or `null` for lexical-only (tests). Omit to auto-load. */
  embedder?: Embedder | null;
  /** Override event persistence; defaults to the M5.3 Spool. */
  onHookEvent?: (event: SessionEvent) => void;
  /** Push the sessions branch after each session_end (default true). */
  spoolPush?: boolean;
  /** Spool size cap in bytes before oldest-first eviction. */
  spoolMaxBytes?: number;
  now?: () => Date;
}

export interface DaemonHandle {
  socketPath: string;
  brainDir: string;
  pid: number;
  /** In-process tool handles (used by tests and the co-located MCP server). */
  tools: Tools;
  /** Event spool (M5.3); null when a custom onHookEvent override is supplied. */
  spool: Spool | null;
  index: SqliteIndex;
  /** Runs a checksum-gated reindex now; resolves to whether it reindexed. */
  reindexNow(): Promise<boolean>;
  /** Current SessionStart context bundle string (sid keys the T7 arm bypass). */
  contextBundle(sid?: string): string;
  close(): Promise<void>;
}

function gitFetch(brainDir: string, logger?: Logger): void {
  // Best-effort: no remote / offline / not a repo are all fine (principle 2).
  execFile(
    'git',
    ['-C', brainDir, 'fetch', '--quiet'],
    // windowsHide: the daemon runs detached without a console, so every git
    // child would otherwise flash a new console window on Windows.
    { timeout: 30_000, windowsHide: true },
    (err) => {
      if (err) {
        logger?.debug('git fetch skipped', { reason: err.message });
      }
    },
  );
}

export async function startDaemon(
  options: StartDaemonOptions,
): Promise<DaemonHandle> {
  const {
    runtimeDir,
    brainDir,
    logger,
    watchIntervalMs = DEFAULT_WATCH_INTERVAL_MS,
    gitFetchIntervalMs = DEFAULT_GIT_FETCH_INTERVAL_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  } = options;
  const now = options.now ?? ((): Date => new Date());

  await mkdir(runtimeDir, { recursive: true });
  const backend = await openBackend({
    runtimeDir,
    brainDir,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.embedder === undefined ? {} : { embedder: options.embedder }),
    ...(logger === undefined ? {} : { logger }),
  });
  const tools = createTools(backend.context);
  const pid = process.pid;

  // Event persistence: the M5.3 spool by default, or a caller override (tests
  // that intercept raw events). The spool is exposed on the handle for audit.
  const spool =
    options.onHookEvent === undefined
      ? new Spool({
          runtimeDir,
          brainDir,
          ...(logger === undefined ? {} : { logger }),
          ...(options.spoolPush === undefined
            ? {}
            : { push: options.spoolPush }),
          ...(options.spoolMaxBytes === undefined
            ? {}
            : { maxBytes: options.spoolMaxBytes }),
        })
      : null;
  const onHookEvent =
    options.onHookEvent ??
    ((event: SessionEvent): void => {
      void spool?.handle(event).catch((err: unknown) => {
        logger?.debug('spool handling failed', {
          reason: (err as Error).message,
        });
      });
    });

  // R16.1 (P1): the daemon's codemap-scoping signal — recently touched
  // repo paths (from tool_use hook events) ∪ the branch diff vs the default
  // branch. brainDir is `<repo>/.teambrain` (C7), so the repo root is its
  // parent. All best-effort; no signal → index-only fallback.
  const sessionPaths = new SessionPathTracker(dirname(brainDir), logger);
  sessionPaths.refreshBranchDiff();

  // R16.1 T7b: control sessions are served no codemap — no scoped slice
  // (paths: []) and no index block (stats: null) — so the bundle is
  // byte-identical to the codemap-off bundle. Treatment (or a sid-less caller,
  // e.g. the heartbeat) keeps the full scoped-slice + index-block behavior.
  const buildContext = (
    sid?: string,
  ): { context: MemoryContext; bundle: string } => {
    const serve = servesCodemap(sid, backend.codemapHoldout);
    const context = tools.memoryContext({
      paths: serve ? sessionPaths.paths() : [],
    });
    const bundle = renderContextBundle(
      context,
      SESSION_CONTEXT_MAX_CHARS,
      serve ? backend.index.codemapStats() : null,
    );
    return { context, bundle };
  };
  const contextBundle = (sid?: string): string => buildContext(sid).bundle;

  // PM (performance-metrics brief §3.1): the daemon is the sole authority on
  // what it injected at session start, so it logs a `memory_retrieved` event
  // tagged `via: 'context'` — the one additive capture the rot metrics need
  // (injection weight/utilization/required-load). It reuses the frozen C2
  // memory_retrieved shape with additive data fields (no CONTRACTS change).
  // Only for an identified session (sid present, from the SessionStart hook)
  // that actually injected something; ids are structural (ULIDs + cm:<path>),
  // never content, so no redaction pass is needed.
  const repo = basename(dirname(brainDir)) || 'unknown';
  const emitInjection = (sid: string, context: MemoryContext): void => {
    const ids = [
      ...context.required.map((view) => view.id),
      ...context.relevant.map((view) => view.id),
    ];
    if (ids.length === 0) return;
    const event: SessionEvent = {
      v: 1,
      sid,
      t: now().toISOString(),
      tool: 'unknown', // the daemon serves every vendor; tool is unused people-free
      model: 'unknown',
      repo,
      branch: 'unknown',
      ev: 'memory_retrieved',
      data: {
        ids,
        via: 'context',
        tokens: context.token_estimate,
        required: context.required.length,
        required_tokens: bundleTokens(context.required),
      },
    };
    onHookEvent(event);
  };

  // --- observability state (surfaced via the heartbeat for `tb doctor`) ---
  const startedAt = now();
  // Index was freshly built in openBackend, so the initial "last reindex" is
  // startup; reindexNow advances it whenever the checksum poll reindexes.
  let lastReindexAt: string = startedAt.toISOString();
  // Per-tool hook liveness: last event time + count, keyed by C2 `tool`.
  const hookHeartbeats = new Map<
    string,
    { lastEventAt: string; count: number }
  >();
  // Rolling window of the daemon's own retrieval (context-render) latencies,
  // last 100, for the p95 `tb doctor` reports (Tech Brief §6).
  const RETRIEVAL_WINDOW = 100;
  const retrievalSamplesMs: number[] = [];
  const recordRetrieval = (ms: number): void => {
    retrievalSamplesMs.push(ms);
    if (retrievalSamplesMs.length > RETRIEVAL_WINDOW)
      retrievalSamplesMs.shift();
  };
  const retrievalP95 = (): number | null => {
    if (retrievalSamplesMs.length === 0) return null;
    const sorted = [...retrievalSamplesMs].sort((a, b) => a - b);
    const rank = Math.ceil(0.95 * sorted.length) - 1;
    return Math.round((sorted[rank] as number) * 1000) / 1000;
  };

  // --- checksum-gated reindex (the watcher cycle) ---
  let reindexing = false;
  const reindexNow = async (): Promise<boolean> => {
    if (reindexing) return false;
    reindexing = true;
    try {
      const result = await syncIndexWithBrain(backend.index, brainDir, {
        ...(logger === undefined ? {} : { logger }),
      });
      if (result.reindexed) {
        lastReindexAt = now().toISOString();
        logger?.debug('daemon reindexed brain', {
          docs: result.docCount,
          checksum: result.checksum,
        });
      }
      return result.reindexed;
    } catch (err) {
      logger?.debug('daemon reindex failed; keeping prior index', {
        reason: (err as Error).message,
      });
      return false;
    } finally {
      reindexing = false;
    }
  };

  // --- heartbeat + pidfile ---
  const writeHeartbeat = (): void => {
    const stats = backend.index.stats();
    const record = {
      pid,
      socket: daemonSocketPath(runtimeDir),
      brainDir,
      runtimeDir,
      startedAt: startedAt.toISOString(),
      lastBeat: now().toISOString(),
      docCount: stats.docCount,
      lexicalOnly: stats.lexicalOnly,
      brainChecksum: stats.brainChecksum,
      lastReindexAt,
      hooks: Object.fromEntries(hookHeartbeats),
      retrieval: {
        p95Ms: retrievalP95(),
        samples: retrievalSamplesMs.length,
      },
    };
    try {
      writeFileSync(
        heartbeatPath(runtimeDir),
        `${JSON.stringify(record, null, 2)}\n`,
        'utf8',
      );
    } catch (err) {
      logger?.debug('heartbeat write failed', {
        reason: (err as Error).message,
      });
    }
  };
  await writeFile(pidFilePath(runtimeDir), `${pid}\n`, 'utf8');

  // --- socket server ---
  const handleRequest = async (raw: string, socket: Socket): Promise<void> => {
    let response: DaemonResponse | null = null;
    try {
      const request = daemonRequestSchema.parse(JSON.parse(raw));
      if (request.kind === 'hook_event') {
        // Per-tool liveness (Tech Brief §6): record before dispatch so the
        // heartbeat reflects the hook even if persistence later degrades.
        const prior = hookHeartbeats.get(request.event.tool);
        hookHeartbeats.set(request.event.tool, {
          lastEventAt: now().toISOString(),
          count: (prior?.count ?? 0) + 1,
        });
        if (
          request.event.ev === 'tool_use' &&
          request.event.data.path !== undefined
        ) {
          sessionPaths.record(request.event.data.path);
        }
        onHookEvent(request.event);
        return; // fire-and-forget: no response
      }
      if (request.kind === 'ping') {
        response = {
          kind: 'pong',
          pid,
          doc_count: backend.index.stats().docCount,
        };
      } else {
        // Time the retrieval so `tb doctor` can report p95 over the window.
        const started = performance.now();
        const { context, bundle } = buildContext(request.sid);
        recordRetrieval(performance.now() - started);
        if (request.sid !== undefined) emitInjection(request.sid, context);
        response = { kind: 'session_context_result', bundle };
      }
    } catch (err) {
      response = { kind: 'error', message: (err as Error).message };
      logger?.debug('daemon rejected a request', {
        reason: (err as Error).message,
      });
    }
    if (response !== null && !socket.destroyed) {
      socket.write(encodeMessage(response));
    }
  };

  const server: Server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = '';
      void handleRequest(line, socket);
    });
    socket.on('error', () => socket.destroy());
  });

  const socketPath = daemonSocketPath(runtimeDir);
  // A stale unix socket file from a crashed daemon blocks listen(); clear it
  // (Windows named pipes need no such cleanup).
  if (process.platform !== 'win32' && existsSync(socketPath)) {
    try {
      rmSync(socketPath);
    } catch {
      /* listen will surface a real conflict */
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  writeHeartbeat();

  // --- timers ---
  const heartbeatTimer = setInterval(writeHeartbeat, heartbeatIntervalMs);
  const watchTimer = setInterval(() => void reindexNow(), watchIntervalMs);
  const fetchTimer = setInterval(() => {
    gitFetch(brainDir, logger);
    // Branch diffs move on the same cadence as remote state.
    sessionPaths.refreshBranchDiff();
  }, gitFetchIntervalMs);
  // Timers must not keep the process alive on their own; the socket server
  // is what holds the daemon open.
  heartbeatTimer.unref();
  watchTimer.unref();
  fetchTimer.unref();

  // --- best-effort fs.watch nudge (recursive unsupported on Linux; poll covers it) ---
  let fsWatcher: FSWatcher | null = null;
  try {
    fsWatcher = watch(
      join(brainDir, 'memories'),
      { recursive: true },
      () => void reindexNow(),
    );
    fsWatcher.on('error', () => fsWatcher?.close());
  } catch (err) {
    logger?.debug('recursive fs.watch unavailable; poll-only', {
      reason: (err as Error).message,
    });
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    clearInterval(watchTimer);
    clearInterval(fetchTimer);
    fsWatcher?.close();
    await sessionPaths.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    backend.close();
    for (const path of [pidFilePath(runtimeDir), heartbeatPath(runtimeDir)]) {
      try {
        rmSync(path);
      } catch {
        /* already gone */
      }
    }
    if (process.platform !== 'win32') {
      try {
        rmSync(socketPath);
      } catch {
        /* already gone */
      }
    }
    logger?.debug('daemon stopped', { pid });
  };

  logger?.info('daemon started', {
    pid,
    socket: socketPath,
    brain: brainDir,
    docs: backend.index.stats().docCount,
  });

  return {
    socketPath,
    brainDir,
    pid,
    tools,
    spool,
    index: backend.index,
    reindexNow,
    contextBundle,
    close,
  };
}
