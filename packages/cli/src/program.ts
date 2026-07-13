import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { CORE_VERSION, exitCodeForError } from '@teambrain/core';
import { supportedTools } from '@teambrain/hooks';
import { runLintCommand } from './lint-command.js';
import { runInitCommand } from './init/init-command.js';
import { runInstallCommand } from './install/install-command.js';
import { runServeCommand } from './serve-command.js';
import { runMcpCommand } from './mcp-command.js';
import { runDoctorCommand } from './doctor-command.js';
import { runHookCommand } from './hook-command.js';
import { runAuditCommand } from './audit-command.js';
import { runDistillCommand } from './distill/distill-command.js';
import { runCodemapCommand } from './distill/codemap-command.js';
import {
  ghGovernanceFriction,
  runDigestCommand,
} from './digest/digest-command.js';
import { runRetireCommand } from './retire/retire-command.js';
import { runReindexCommand } from './reindex-command.js';
import { runProposeCommand } from './propose-command.js';
import { commandHelpAfter, HELP, ROOT_HELP_AFTER } from './help-text.js';

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

/** Build the full `tb` commander program (exported for help tests). */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('tb')
    .description('TeamBrain — git-native shared memory for AI coding agents')
    .version(CORE_VERSION)
    .addHelpText('after', ROOT_HELP_AFTER);

  program
    .command('lint')
    .description(
      'validate memories: schema, size limits, evidence, injection heuristics',
    )
    .helpGroup('Quality')
    .argument(
      '[path]',
      'brain directory or single .md memory file',
      '.teambrain',
    )
    .option(
      '--require-evidence',
      'fail memories with no evidence citations (distill PR gate)',
      false,
    )
    .addHelpText('after', commandHelpAfter(HELP.lint))
    .action((targetPath: string, opts: { requireEvidence: boolean }) => {
      try {
        const { exitCode, output } = runLintCommand(targetPath, {
          requireEvidence: opts.requireEvidence,
        });
        process.stdout.write(output);
        process.exitCode = exitCode;
      } catch (err) {
        process.stderr.write(`tb lint: ${(err as Error).message}\n`);
        process.exitCode = exitCodeForError(err);
      }
    });

  program
    .command('init')
    .description(
      'import agent rules (CLAUDE.md, cursor rules, ADRs) into a PR-ready branch',
    )
    .helpGroup('Setup')
    .argument('[path]', 'repository to scan and initialize', '.')
    .option(
      '--yes',
      'skip the gap-filling interview (also skipped when stdin is not a TTY)',
      false,
    )
    .addHelpText('after', commandHelpAfter(HELP.init))
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
    .description(
      'register MCP server + capture wiring for an agent tool (idempotent)',
    )
    .helpGroup('Setup')
    .argument('<tool>', `agent tool: ${supportedTools().join(' | ')}`)
    .argument('[path]', 'project directory to install into', '.')
    .option('--yes', 'apply without showing a diff (for CI)', false)
    .addHelpText('after', commandHelpAfter(HELP.install))
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
    .description(
      'run the local daemon (index, brain watcher, capture socket, MCP backend)',
    )
    .helpGroup('Daemon')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .addHelpText('after', commandHelpAfter(HELP.serve))
    .action(async (repoDir: string) => {
      const { exitCode, output } = await runServeCommand(repoDir);
      process.stdout.write(output);
      process.exitCode = exitCode;
    });

  program
    .command('mcp', { hidden: true })
    .description('run the stdio MCP server (spawned by the agent tool)')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .option(
      '--client <name>',
      'connecting agent id; enables MCP-side session inference for tools without native hooks (e.g. cursor, codex)',
    )
    .addHelpText('after', commandHelpAfter(HELP.mcp))
    .action(async (repoDir: string, opts: { client?: string }) => {
      await runMcpCommand(repoDir, { client: opts.client });
    });

  program
    .command('audit')
    .description(
      "print a session's stored record and redaction summary (trust feature)",
    )
    .helpGroup('Capture')
    .argument('[sid]', 'session ULID (default: most recent record)')
    .option(
      '--last-session',
      'audit the most recent session (default when [sid] is omitted)',
      false,
    )
    .addHelpText('after', commandHelpAfter(HELP.audit))
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
      'cluster sessions and open a memory proposals PR (CI distiller)',
    )
    .helpGroup('Quality')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .option(
      '--dry-run',
      'print the would-be PR without git writes or gh calls',
      false,
    )
    .option(
      '--codemap',
      'update .teambrain/codemap/ instead (requires codemap.enabled)',
      false,
    )
    .addHelpText('after', commandHelpAfter(HELP.distill))
    .action(
      async (repoDir: string, opts: { dryRun: boolean; codemap: boolean }) => {
        const { exitCode, output } = opts.codemap
          ? await runCodemapCommand(repoDir)
          : await runDistillCommand(repoDir, { dryRun: opts.dryRun });
        process.stdout.write(output);
        process.exitCode = exitCode;
      },
    );

  program
    .command('retire')
    .description('open a PR retiring a memory (moves it to retired/)')
    .helpGroup('Capture')
    .argument('<id>', 'ULID of the memory to retire')
    .argument('<reason>', 'why it is being retired (shown in the PR body)')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .addHelpText('after', commandHelpAfter(HELP.retire))
    .action((id: string, reason: string, repoDir: string) => {
      const { exitCode, output } = runRetireCommand(repoDir, id, reason);
      process.stdout.write(output);
      process.exitCode = exitCode;
    });

  program
    .command('digest')
    .description('post a people-free weekly digest to Slack (CI automation)')
    .helpGroup('Quality')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .option('--dry-run', 'print digest JSON instead of posting to Slack', false)
    .addHelpText('after', commandHelpAfter(HELP.digest))
    .action(async (repoDir: string, opts: { dryRun: boolean }) => {
      const { exitCode, output } = await runDigestCommand(repoDir, {
        dryRun: opts.dryRun,
      });
      process.stdout.write(output);
      process.exitCode = exitCode;
    });

  program
    .command('propose')
    .description(
      'queue a candidate memory for the next distill PR (local spool only)',
    )
    .helpGroup('Capture')
    .requiredOption(
      '--class <class>',
      'memory class: decision | convention | map | learning',
    )
    .requiredOption('--title <title>', 'candidate title (≤80 characters)')
    .option('--body <text>', 'candidate body (≤400 words; or pipe on stdin)')
    .option(
      '--tag <tag>',
      'tag to attach (repeatable)',
      (value: string, all: string[]) => [...all, value],
      [] as string[],
    )
    .addHelpText('after', commandHelpAfter(HELP.propose))
    .action(
      (opts: {
        class: string;
        title: string;
        body?: string;
        tag: string[];
      }) => {
        const { exitCode, output } = runProposeCommand({
          class: opts.class,
          title: opts.title,
          ...(opts.body === undefined ? {} : { body: opts.body }),
          tags: opts.tag,
        });
        process.stdout.write(output);
        process.exitCode = exitCode;
      },
    );

  program
    .command('reindex')
    .description(
      'rebuild ~/.teambrain/index.db from the brain repo (recovery path)',
    )
    .helpGroup('Daemon')
    .argument('[path]', 'repository containing .teambrain/', '.')
    .addHelpText('after', commandHelpAfter(HELP.reindex))
    .action(async (repoDir: string) => {
      const { exitCode, output } = await runReindexCommand(repoDir);
      process.stdout.write(output);
      process.exitCode = exitCode;
    });

  program
    .command('doctor')
    .description('report daemon, index, capture, and sync health')
    .helpGroup('Daemon')
    .option('--json', 'emit machine-readable JSON report', false)
    .addHelpText('after', commandHelpAfter(HELP.doctor))
    .action(async (opts: { json: boolean }) => {
      // Live gh query supplied here so runDoctorCommand (and its tests)
      // stays free of subprocess side effects (D3.1).
      const governance = ghGovernanceFriction(process.cwd());
      const { exitCode, output } = await runDoctorCommand({
        json: opts.json,
        ...(governance === undefined ? {} : { governance }),
      });
      process.stdout.write(output);
      process.exitCode = exitCode;
    });

  program
    .command('hook', { hidden: true })
    .description('internal hook entrypoint invoked by the agent tool')
    .argument('<event>', 'session-start | post-tool-use | stop | session-end')
    .option(
      '--tool <id>',
      'agent tool id for event labeling (default: claude-code)',
    )
    .addHelpText('after', commandHelpAfter(HELP.hook))
    .action(async (event: string, opts: { tool?: string }) => {
      const { exitCode, output } = await runHookCommand(event, {
        ...(opts.tool === undefined ? {} : { tool: opts.tool }),
      });
      if (output.length > 0) process.stderr.write(output);
      process.exitCode = exitCode;
    });

  return program;
}
