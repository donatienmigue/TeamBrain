import { CORE_VERSION } from '@teambrain/core';

export function cliVersion(): string {
  return CORE_VERSION;
}

export { runLintCommand } from './lint-command.js';
export type { LintCommandResult } from './lint-command.js';
