#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { CORE_VERSION, exitCodeForError } from '@teambrain/core';
import { runLintCommand } from './lint-command.js';
import { runInitCommand } from './init/init-command.js';
import { runInstallCommand } from './install/install-command.js';
import { runServeCommand } from './serve-command.js';
import { runMcpCommand } from './mcp-command.js';
import { runDoctorCommand } from './doctor-command.js';
import { runHookCommand } from './hook-command.js';
import { runAuditCommand } from './audit-command.js';
import { runDistillCommand } from './distill/distill-command.js';

/** Reads a single y/N answer from a TTY for `tb install`'s confirm step. */
function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

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

program
  .command('init')
  .description(
    'import existing agent knowledge (CLAUDE.md, cursor rules, ADRs) ' +
      'into a PR-ready teambrain/init branch',
  )
  .argument('[path]', 'repository to initialize', '.')
  .option('--yes', 'skip the interview (also skipped when not a TTY)', false)
  .action(async (repoDir: string, opts: { yes: boolean }) => {
    const interactive = !opts.yes && process.stdin.isTTY === true;
    const { exitCode, output } = await runInitCommand(repoDir, {
      interview: interactive,
      io: { input: process.stdin, output: process.stdout },
    });
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('install')
  .description('write MCP + hook config for an agent tool (idempotent)')
  .argument('<tool>', 'claude-code (cursor is deferred)')
  .argument('[path]', 'project directory to install into', '.')
  .option('--yes', 'apply without confirmation (for CI)', false)
  .action(async (tool: string, targetDir: string, opts: { yes: boolean }) => {
    const interactive = !opts.yes && process.stdin.isTTY === true;
    const { exitCode, output } = await runInstallCommand(tool, targetDir, {
      yes: opts.yes,
      ...(interactive ? { confirm: promptConfirm } : {}),
    });
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('serve')
  .description('run the daemon: MCP index + brain watcher + hook socket')
  .argument('[path]', 'repository holding the brain', '.')
  .action(async (repoDir: string) => {
    const { exitCode, output } = await runServeCommand(repoDir);
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('mcp')
  .description('run the stdio MCP server (launched by the agent tool)')
  .argument('[path]', 'repository holding the brain', '.')
  .action(async (repoDir: string) => {
    await runMcpCommand(repoDir);
  });

program
  .command('audit')
  .description("print a session's stored record with a redaction summary")
  .argument('[sid]', 'session id to audit (default: the most recent)')
  .option('--last-session', 'audit the most recent session (default)', false)
  .action((sid: string | undefined) => {
    const { exitCode, output } = runAuditCommand(
      sid === undefined ? {} : { sid },
    );
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('distill')
  .description(
    'distill recent sessions into proposed memories on a PR branch ' +
      '(collect → cluster → draft → dedup → gate)',
  )
  .argument('[path]', 'repository holding the brain', '.')
  .option(
    '--dry-run',
    'print the would-be PR without any git side effects',
    false,
  )
  .action(async (repoDir: string, opts: { dryRun: boolean }) => {
    const { exitCode, output } = await runDistillCommand(repoDir, {
      dryRun: opts.dryRun,
    });
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('doctor')
  .description('report daemon + index health')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { json: boolean }) => {
    const { exitCode, output } = await runDoctorCommand({ json: opts.json });
    process.stdout.write(output);
    process.exitCode = exitCode;
  });

program
  .command('hook')
  .description('internal: hook bodies invoked by the agent tool')
  .argument('<event>', 'session-start')
  .action(async (event: string) => {
    const { exitCode, output } = await runHookCommand(event);
    if (output.length > 0) process.stderr.write(output);
    process.exitCode = exitCode;
  });

// parseAsync: the init action is async; plain parse() would leave its
// promise dangling and turn any unexpected rejection into a crash.
await program.parseAsync();
