import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fakeProvider } from '../fake-provider.js';
import { updateCodemap } from '../codemap/generate.js';

// D6 acceptance budget: incremental CodeMap update on a 500k-LOC synthetic
// repo in <2 min (Tech Brief §4.8). The fixture is 5,000 files × 100 lines;
// after a full build, a 20-file change must reprocess exactly 20 files and
// finish inside the budget. Runs fully offline (fake provider), so the
// budget exercises the real cost — walking + hashing 500k LOC — not LLM
// latency, which CI could never bound anyway.

const INCREMENTAL_BUDGET_MS = 120_000;
const FILE_COUNT = 5_000;
const LINES_PER_FILE = 100;
const CHANGED_FILES = 20;

function fileBody(index: number, revision: number): string {
  const lines: string[] = [];
  for (let line = 0; line < LINES_PER_FILE; line += 1) {
    lines.push(
      `export const symbol_${index}_${line} = ${line + revision}; // filler`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function filePath(index: number): string {
  return join(`pkg${index % 50}`, `mod${index % 200}`, `file${index}.ts`);
}

async function main(): Promise<void> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'tb-codemap-bench-'));
  try {
    const brainDir = join(repoRoot, '.teambrain');
    console.log(
      `codemap bench: synthesizing ${FILE_COUNT} files × ${LINES_PER_FILE} lines (~500k LOC)`,
    );
    for (let i = 0; i < FILE_COUNT; i += 1) {
      const path = join(repoRoot, filePath(i));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, fileBody(i, 0), 'utf8');
    }

    const provider = fakeProvider(() => ({ summary: 'Bench summary.' }));

    const fullStart = performance.now();
    const full = await updateCodemap({ repoRoot, brainDir, provider });
    const fullMs = performance.now() - fullStart;
    console.log(
      `codemap bench: full build ${full.summarized.length} files in ${(fullMs / 1000).toFixed(1)}s`,
    );
    if (full.summarized.length !== FILE_COUNT) {
      throw new Error(
        `full build summarized ${full.summarized.length}, expected ${FILE_COUNT}`,
      );
    }

    for (let i = 0; i < CHANGED_FILES; i += 1) {
      const index = i * 37; // spread across directories
      await writeFile(
        join(repoRoot, filePath(index)),
        fileBody(index, 1),
        'utf8',
      );
    }

    const incrementalStart = performance.now();
    const incremental = await updateCodemap({ repoRoot, brainDir, provider });
    const incrementalMs = performance.now() - incrementalStart;
    console.log(
      `codemap bench: incremental ${incremental.summarized.length} changed files in ` +
        `${(incrementalMs / 1000).toFixed(1)}s (budget ${INCREMENTAL_BUDGET_MS / 1000}s)`,
    );

    if (incremental.summarized.length !== CHANGED_FILES) {
      throw new Error(
        `incremental run reprocessed ${incremental.summarized.length} files, expected ${CHANGED_FILES}`,
      );
    }
    if (incremental.unchanged !== FILE_COUNT - CHANGED_FILES) {
      throw new Error(
        `incremental run reused ${incremental.unchanged} summaries, expected ${FILE_COUNT - CHANGED_FILES}`,
      );
    }
    if (incrementalMs >= INCREMENTAL_BUDGET_MS) {
      throw new Error(
        `incremental update took ${Math.round(incrementalMs)}ms, budget ${INCREMENTAL_BUDGET_MS}ms`,
      );
    }
    console.log('codemap bench: all budgets met');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(`codemap bench: FAIL — ${(err as Error).message}`);
  process.exitCode = 1;
});
