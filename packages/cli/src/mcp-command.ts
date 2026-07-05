import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from '@teambrain/core';
import { openBackend, resolveRuntimeDir, runMcpServer } from '@teambrain/mcp';

// `tb mcp` (M4.2 entry): the stdio MCP server Claude Code launches per
// session (registered by `tb install`). stdout is the MCP transport, so this
// path must never write to it — all diagnostics go to the file logger.

export async function runMcpCommand(repoDir: string): Promise<void> {
  const root = resolve(repoDir);
  const brainDir = join(root, '.teambrain');
  const logger = createLogger().child({ component: 'mcp' });
  const backend = await openBackend({
    runtimeDir: resolveRuntimeDir(),
    ...(existsSync(brainDir) ? { brainDir } : {}),
    logger,
  });
  await runMcpServer(backend.context);
  // Stay alive on the stdio transport until the parent closes stdin.
  await new Promise<void>((resolvePromise) => {
    process.stdin.on('close', resolvePromise);
    process.once('SIGINT', resolvePromise);
    process.once('SIGTERM', resolvePromise);
  });
  backend.close();
}
