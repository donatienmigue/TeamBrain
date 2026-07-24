import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createLogger,
  parseBrainConfig,
  type SessionEvent,
} from '@teambrain/core';
import {
  ensureDaemon,
  openBackend,
  resolveRuntimeDir,
  runMcpServer,
  sendTiming,
  servesCodemap,
} from '@teambrain/mcp';
import { sendHookEvent } from '@teambrain/mcp/hook-client';
import { ADAPTERS, buildHookContext } from '@teambrain/hooks';
import { latestSessionSid } from './propose-command.js';

// `tb mcp` (M4.2 entry): the stdio MCP server Claude Code launches per
// session (registered by `tb install`). stdout is the MCP transport, so this
// path must never write to it — all diagnostics go to the file logger.

/** brain.yaml `daemon.autostart`, or undefined when unreadable/absent. */
function readAutostartConfig(brainDir: string): boolean | undefined {
  try {
    const configPath = join(brainDir, 'brain.yaml');
    if (!existsSync(configPath)) return undefined;
    return parseBrainConfig(readFileSync(configPath, 'utf8')).daemon.autostart;
  } catch {
    return undefined; // malformed config never blocks the session
  }
}

export async function runMcpCommand(
  repoDir: string,
  opts: { client?: string } = {},
): Promise<void> {
  const root = resolve(repoDir);
  const brainDir = join(root, '.teambrain');
  const logger = createLogger().child({ component: 'mcp' });

  // Auto-start the daemon at MCP boot — the agent spawns `tb mcp` on every
  // session, so this is the most reliable trigger across vendors. Failure →
  // proceed exactly as today (the backend serves without the daemon).
  const autostart = readAutostartConfig(brainDir);
  await ensureDaemon({
    runtimeDir: resolveRuntimeDir(),
    ...(autostart === undefined ? {} : { enabled: autostart }),
  });

  const backend = await openBackend({
    runtimeDir: resolveRuntimeDir(),
    ...(existsSync(brainDir) ? { brainDir } : {}),
    logger,
  });

  // Tier-B capture: any registered mcp-inference client (cursor, codex, …)
  // gets its MCP tool calls intercepted to infer session boundaries.
  const adapter = opts.client === undefined ? undefined : ADAPTERS[opts.client];
  if (adapter !== undefined && adapter.tier === 'mcp-inference') {
    const { wrapInferenceContext } = await import('./inference-wrapper.js');
    backend.context = wrapInferenceContext(backend.context, root, adapter.tool);
  }

  // R16.1 T7b: the search-side control-arm bypass. The stdio MCP server is
  // per-session but sid-less by default; it reads the session id from
  // TEAMBRAIN_SESSION_ID (wired by `tb install` where the client exposes a
  // per-session value). Absent/empty → treatment (serve), i.e. behavior is
  // unchanged from before the holdout existed.
  const sid = process.env['TEAMBRAIN_SESSION_ID'];
  const serveCodemap = servesCodemap(sid, backend.codemapHoldout);
  if (sid !== undefined && sid.length > 0 && !serveCodemap) {
    logger.debug('codemap control arm: memory_search excludes codemap', {});
  }

  const runtimeDir = resolveRuntimeDir();

  // A2/A3: ground agent proposals and route them to CI. Resolve the active
  // session the way `tb propose` does — the client-exposed id, else the most
  // recent session record in the spool — then (A2) stamp it as evidence and
  // (A3) emit a C2 `candidate_proposed` event, because the local candidate
  // spool is never synced (C7) and the distiller reads only the sessions
  // branch. No session resolvable → evidence omitted, event skipped, local
  // spool still written (graceful degradation, as `tb propose` does).
  const proposeSid =
    (sid !== undefined && sid.length > 0 ? sid : undefined) ??
    latestSessionSid(runtimeDir) ??
    undefined;
  backend.context.resolveEvidence = () =>
    proposeSid === undefined ? undefined : { sessions: [proposeSid], commits: [] };
  // The mcp-inference path (Cursor/codex) already emits candidate_proposed via
  // its interceptor; wiring the tools-level emit only on the native-hook path
  // keeps CI seeing exactly one event.
  if (adapter === undefined || adapter.tier !== 'mcp-inference') {
    const hookCtx = buildHookContext({
      cwd: root,
      sid: proposeSid ?? 'unknown',
      ...(adapter?.tool === undefined ? {} : { tool: adapter.tool }),
    });
    backend.context.emitCandidateProposed = (draft): void => {
      if (proposeSid === undefined) return; // no session → local spool only
      const event = {
        v: 1,
        sid: proposeSid,
        t: new Date().toISOString(),
        tool: hookCtx.tool,
        model: hookCtx.model,
        repo: hookCtx.repo,
        branch: hookCtx.branch,
        ev: 'candidate_proposed',
        data: { draft },
      } as SessionEvent;
      // Fire-and-forget to the daemon (principle 2): a failed emit leaves the
      // local spool copy intact; never block or throw on the propose path.
      void sendHookEvent(runtimeDir, event).catch((err: unknown) => {
        logger.debug('candidate_proposed emit dropped: daemon unreachable', {
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    };
  }

  await runMcpServer(backend.context, {
    serveCodemap,
    // PM §3.2: report real search latencies to the daemon (fire-and-forget).
    onTiming: (_metric, ms) => void sendTiming(runtimeDir, 'search', ms),
  });
  // Stay alive on the stdio transport until the parent closes stdin.
  await new Promise<void>((resolvePromise) => {
    process.stdin.on('close', resolvePromise);
    process.once('SIGINT', resolvePromise);
    process.once('SIGTERM', resolvePromise);
  });
  backend.close();
}
