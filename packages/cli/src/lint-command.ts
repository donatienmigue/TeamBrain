import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  lintBrain,
  lintMemoryText,
  type LintOptions,
  type LintViolation,
} from '@teambrain/core';

// C6 exit codes: 0 ok, 1 user error, 3 lint/validation failure.
export interface LintCommandResult {
  exitCode: 0 | 1 | 3;
  output: string;
}

function renderViolations(
  violations: LintViolation[],
  fileCount: number,
): string {
  const lines = violations.map(
    (violation) =>
      `${violation.file}: [${violation.rule}] ${violation.message}`,
  );
  const affectedFiles = new Set(violations.map((violation) => violation.file));
  lines.push(
    `tb lint: ${violations.length} violation(s) in ${affectedFiles.size} file(s) (${fileCount} memory file(s) checked)`,
  );
  return lines.join('\n') + '\n';
}

export function runLintCommand(
  targetPath: string,
  options: LintOptions = {},
): LintCommandResult {
  if (!existsSync(targetPath)) {
    return { exitCode: 1, output: `tb lint: path not found: ${targetPath}\n` };
  }

  let violations: LintViolation[];
  let fileCount: number;
  if (statSync(targetPath).isDirectory()) {
    ({ violations, memoryFileCount: fileCount } = lintBrain(
      targetPath,
      options,
    ));
  } else {
    // Single-file mode (per-file CI checks). Normalize separators so the
    // core placement checks can locate memories/ and retired/ segments.
    const normalizedPath = targetPath.split(/[\\/]+/).join('/');
    violations = lintMemoryText(
      normalizedPath,
      readFileSync(targetPath, 'utf8'),
      options,
    );
    fileCount = 1;
  }

  if (violations.length === 0) {
    return {
      exitCode: 0,
      output: `tb lint: ${fileCount} memory file(s) checked, no violations\n`,
    };
  }
  return { exitCode: 3, output: renderViolations(violations, fileCount) };
}
