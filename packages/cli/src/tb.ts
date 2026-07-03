#!/usr/bin/env node
import { Command } from 'commander';
import { CORE_VERSION, exitCodeForError } from '@teambrain/core';
import { runLintCommand } from './lint-command.js';

const program = new Command();

program
  .name('tb')
  .description('TeamBrain — git-native shared memory for AI coding agents')
  .version(CORE_VERSION);

program
  .command('lint')
  .description(
    'validate memories: schema, size limits, evidence, injection heuristics',
  )
  .argument('[path]', 'brain directory or single memory file', '.teambrain')
  .option(
    '--require-evidence',
    'fail memories that cite no evidence (distill PR check)',
    false,
  )
  .action((targetPath: string, opts: { requireEvidence: boolean }) => {
    try {
      const { exitCode, output } = runLintCommand(targetPath, {
        requireEvidence: opts.requireEvidence,
      });
      process.stdout.write(output);
      process.exitCode = exitCode;
    } catch (err) {
      // Typed errors carry their C6 exit code; anything unexpected is
      // an environment error (exit 2).
      process.stderr.write(`tb lint: ${(err as Error).message}\n`);
      process.exitCode = exitCodeForError(err);
    }
  });

program.parse();
