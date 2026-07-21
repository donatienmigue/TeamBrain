import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_VERSION } from '@teambrain/core';
import { resolveRuntimeDir } from '@teambrain/mcp';
import {
  buildReport,
  renderHuman,
  renderJson,
  type CheckContext,
  type CheckOutcome,
} from './framework.js';
import { CHECK_REGISTRY } from './checks.js';

// E1 orchestrator for `tb verify`. Resolves the target brain (exit 1 when the
// repo has none — V8's "run outside a brain repo" gate), runs the check
// registry, and renders the report. Exit codes come from the checks (0/2/3);
// the pre-check "no brain here" is the only place this command emits 1.

export interface VerifyOptions {
  json?: boolean;
  strict?: boolean;
  offline?: boolean;
  runtimeDir?: string;
  now?: () => Date;
}

/** Count memory files under the brain (footer only; excludes retired/). */
function countMemories(brainDir: string): number | null {
  const memoriesDir = join(brainDir, 'memories');
  if (!existsSync(memoriesDir)) return null;
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) count++;
    }
  };
  walk(memoriesDir);
  return count;
}

export async function runVerifyCommand(
  repoDir: string,
  options: VerifyOptions = {},
): Promise<{ exitCode: 0 | 1 | 2 | 3; output: string }> {
  const brainDir = join(repoDir, '.teambrain');
  if (!existsSync(brainDir)) {
    return {
      exitCode: 1,
      output:
        `tb verify: no brain here (${brainDir} not found).\n` +
        `Run \`tb init\` first, or point at a repo that has a .teambrain/ brain.\n`,
    };
  }

  const now = options.now ?? ((): Date => new Date());
  const ctx: CheckContext = {
    version: CORE_VERSION,
    repoDir,
    brainDir,
    runtimeDir: options.runtimeDir ?? resolveRuntimeDir(),
    offline: options.offline ?? false,
    strict: options.strict ?? false,
    now,
  };

  const outcomes: CheckOutcome[] = [];
  for (const check of CHECK_REGISTRY) {
    outcomes.push(await check.run(ctx));
  }

  const report = buildReport(outcomes, {
    version: CORE_VERSION,
    provenanceCommit: null, // set by V1 once the provenance check lands
    brainMemoryCount: countMemories(brainDir),
    generatedAt: now().toISOString(),
  });

  const output =
    options.json === true ? renderJson(report) : renderHuman(report);
  return { exitCode: report.exitCode, output };
}
