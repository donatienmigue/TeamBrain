import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserError, exitCodeForError, parseBrainConfig } from '@teambrain/core';
import {
  anthropicProvider,
  updateCodemap,
  type Provider,
} from '@teambrain/distill';

// D6/R16: `tb distill --codemap` — the CI entrypoint for the incremental
// CodeMap update (Tech Brief §4.8). Rides the existing distill command (C6's
// command list is frozen; a flag is additive). Refuses to run unless
// brain.yaml sets codemap.enabled: true, so the feature is opt-in end to end.

export interface CodemapCommandResult {
  exitCode: 0 | 1 | 2;
  output: string;
}

export interface CodemapCommandOptions {
  /** Override for offline tests; production builds the Anthropic driver. */
  provider?: Provider;
  now?: () => Date;
}

function resolveRepoRoot(repoDir: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new UserError(`${repoDir} is not a git repository`);
  }
}

export async function runCodemapCommand(
  repoDir: string,
  options: CodemapCommandOptions = {},
): Promise<CodemapCommandResult> {
  try {
    const repoRoot = resolveRepoRoot(repoDir);
    const brainDir = join(repoRoot, '.teambrain');
    if (!existsSync(brainDir)) {
      throw new UserError(`no ${brainDir} — run \`tb init\` first`);
    }
    const config = parseBrainConfig(
      readFileSync(join(brainDir, 'brain.yaml'), 'utf8'),
    );
    if (config.codemap.enabled !== true) {
      throw new UserError(
        'codemap is disabled — set `codemap.enabled: true` in .teambrain/brain.yaml to opt in',
      );
    }

    // Model pinned from brain.yaml when present (CONTRACTS C5).
    const model = config.distill?.model;
    const provider =
      options.provider ??
      anthropicProvider(model === undefined ? {} : { model });

    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return {
      exitCode: 0,
      output:
        `tb distill --codemap: ${result.summarized.length} summarized, ` +
        `${result.unchanged} unchanged, ${result.removed.length} removed ` +
        `(${result.total} source files)\n` +
        'Commit .teambrain/codemap/ to publish the update.\n',
    };
  } catch (err) {
    return {
      exitCode: exitCodeForError(err) as 1 | 2,
      output: `tb distill --codemap: ${(err as Error).message}\n`,
    };
  }
}
