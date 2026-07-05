import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  UserError,
  exitCodeForError,
  type ErrorExitCode,
} from '@teambrain/core';
import {
  ensureMcpServer,
  ensureSessionStartHook,
  lineDiff,
  serializeSettings,
} from './settings.js';

// Orchestrates the idempotent install. Each target file is read, merged with
// a pure ensure* function, and rewritten only when its serialized form
// changes — so a second run is a genuine no-op (the M4.3 accept criterion).

export const SUPPORTED_TOOLS = ['claude-code'] as const;
export type InstallTool = (typeof SUPPORTED_TOOLS)[number];

export interface InstallOptions {
  yes?: boolean;
  /** Confirm callback for interactive runs; omitted in CI (use `yes`). */
  confirm?: (prompt: string) => Promise<boolean>;
}

export interface InstallCommandResult {
  exitCode: 0 | ErrorExitCode;
  output: string;
}

interface FilePlan {
  label: string;
  path: string;
  before: string;
  after: string;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error('expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new UserError(
      `cannot install: ${path} is not valid JSON (${(err as Error).message}) — fix or remove it first`,
    );
  }
}

function planFor(
  label: string,
  path: string,
  merge: (existing: Record<string, unknown>) => {
    value: Record<string, unknown>;
  },
): FilePlan {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const merged = merge(readJson(path));
  return { label, path, before, after: serializeSettings(merged.value) };
}

export async function runInstallCommand(
  tool: string,
  targetDir: string,
  options: InstallOptions = {},
): Promise<InstallCommandResult> {
  try {
    if (!(SUPPORTED_TOOLS as readonly string[]).includes(tool)) {
      throw new UserError(
        `unsupported tool '${tool}' — supported: ${SUPPORTED_TOOLS.join(', ')} (cursor is deferred)`,
      );
    }
    const root = resolve(targetDir);
    const plans: FilePlan[] = [
      planFor(
        'MCP server (.mcp.json)',
        join(root, '.mcp.json'),
        ensureMcpServer,
      ),
      planFor(
        'SessionStart hook (.claude/settings.json)',
        join(root, '.claude', 'settings.json'),
        ensureSessionStartHook,
      ),
    ];

    const changed = plans.filter((plan) => plan.before !== plan.after);
    if (changed.length === 0) {
      return {
        exitCode: 0,
        output: `TeamBrain is already installed for ${tool} — no changes.\n`,
      };
    }

    let output = `tb install ${tool} will update:\n`;
    for (const plan of changed) {
      output += `\n  ${plan.label}\n`;
      output += lineDiff(plan.before, plan.after)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      output += '\n';
    }

    if (options.yes !== true) {
      const ok =
        options.confirm !== undefined &&
        (await options.confirm('\nApply these changes? [y/N] '));
      if (!ok) {
        return {
          exitCode: 0,
          output: `${output}\nAborted — no files written. Re-run with --yes to apply.\n`,
        };
      }
    }

    for (const plan of changed) {
      mkdirSync(dirname(plan.path), { recursive: true });
      writeFileSync(plan.path, plan.after, 'utf8');
    }
    return {
      exitCode: 0,
      output: `${output}\nInstalled TeamBrain for ${tool} (${changed.length} file(s) written).\nEnsure \`tb\` is on your PATH so the hook and MCP server can launch.\n`,
    };
  } catch (err) {
    return {
      exitCode: exitCodeForError(err),
      output: `tb install: ${(err as Error).message}\n`,
    };
  }
}
