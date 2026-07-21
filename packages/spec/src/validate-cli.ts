#!/usr/bin/env node
import { validateBrain } from './validate.js';

// `npx @teambrain/spec <brainDir>` — validates a brain against the C1/C2 spec.
// Exit 0 conformant, 1 on any violation. No TeamBrain runtime needed.

function main(): void {
  const target = process.argv[2] ?? '.teambrain';
  const result = validateBrain(target);
  if (result.ok) {
    process.stdout.write(
      `conformant: ${result.checked} file(s) match MEMORY-FORMAT-1.0 / SESSION-EVENT-1.0\n`,
    );
    process.exitCode = 0;
    return;
  }
  process.stderr.write(
    `non-conformant: ${result.errors.length} of ${result.checked} checks failed\n`,
  );
  for (const e of result.errors) {
    process.stderr.write(`  ${e.path}: ${e.message.split('\n')[0]}\n`);
  }
  process.exitCode = 1;
}

main();
