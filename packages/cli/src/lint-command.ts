import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Where a directory argument actually points. `tb lint .` from a repo root is
 * the documented-looking form but the argument is the *brain* directory, so we
 * resolve one level into `.teambrain/` when that is where the brain lives.
 *
 * Resolution is deliberately one level deep — no upward search toward the git
 * root, no recursion. A brain that has `memories/` but no `brain.yaml` still
 * resolves to itself so `lintBrain` can report the schema violation: a
 * malformed brain is a lint failure (exit 3), not a wrong path (exit 1).
 */
type BrainResolution =
  { kind: 'brain'; dir: string; note?: string } | { kind: 'none' };

export function resolveBrainDir(targetPath: string): BrainResolution {
  if (existsSync(join(targetPath, 'brain.yaml'))) {
    return { kind: 'brain', dir: targetPath };
  }

  const nested = join(targetPath, '.teambrain');
  if (existsSync(join(nested, 'brain.yaml'))) {
    return {
      kind: 'brain',
      dir: nested,
      note: `tb lint: linting ${nested}`,
    };
  }

  // Brain layout present but config deleted — lint it and let the schema rule
  // fire. Collapsing this into `none` would hide a real violation.
  for (const layoutRoot of ['memories', 'retired']) {
    if (existsSync(join(targetPath, layoutRoot))) {
      return { kind: 'brain', dir: targetPath };
    }
  }

  return { kind: 'none' };
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
  let prefix = '';
  if (statSync(targetPath).isDirectory()) {
    const resolved = resolveBrainDir(targetPath);
    if (resolved.kind === 'none') {
      return {
        exitCode: 1,
        output:
          `tb lint: no brain found at ${targetPath} ` +
          `(looked for brain.yaml and .teambrain/brain.yaml)\n`,
      };
    }
    // Goes to stdout ahead of the result so CI logs record which directory was
    // actually linted.
    if (resolved.note !== undefined) prefix = `${resolved.note}\n`;
    ({ violations, memoryFileCount: fileCount } = lintBrain(
      resolved.dir,
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
      output:
        prefix +
        `tb lint: ${fileCount} memory file(s) checked, no violations\n`,
    };
  }
  return {
    exitCode: 3,
    output: prefix + renderViolations(violations, fileCount),
  };
}
