import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, parseBrainConfig } from '@teambrain/core';
import {
  ensureDaemon,
  openBackend,
  resolveRuntimeDir,
  runMcpServer,
} from '@teambrain/mcp';
import { ADAPTERS } from '@teambrain/hooks';

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

  await runMcpServer(backend.context);
  // Stay alive on the stdio transport until the parent closes stdin.
  await new Promise<void>((resolvePromise) => {
    process.stdin.on('close', resolvePromise);
    process.once('SIGINT', resolvePromise);
    process.once('SIGTERM', resolvePromise);
  });
  backend.close();
}
