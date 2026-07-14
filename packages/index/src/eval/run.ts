import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HashingEmbedder,
  defaultModelsDir,
  tryCreateFastEmbedEmbedder,
} from '../embeddings.js';
import { loadEvalQueries } from './queries.js';
import { renderEvalReport, runEval } from './runner.js';

// `pnpm eval` (R10): measure retrieval on the real corpus with the REAL
// production embedder (fastembed bge-small — downloaded on first run).
// This is a human-run measurement, not a CI gate; `pnpm bench` stays the
// offline synthetic smoke test. TEAMBRAIN_EVAL_OFFLINE=1 substitutes the
// HashingEmbedder for a fast plumbing check whose numbers mean nothing
// about production retrieval quality (the header says so).

// dist/eval/run.js → repo root is four levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const CORPUS_DIR = join(REPO_ROOT, 'testdata', 'eval', 'corpus');
const QUERIES_PATH = join(REPO_ROOT, 'testdata', 'eval', 'queries.yaml');

async function main(): Promise<void> {
  const queries = await loadEvalQueries(QUERIES_PATH);

  const offline = process.env['TEAMBRAIN_EVAL_OFFLINE'] === '1';
  const embedder = offline
    ? new HashingEmbedder()
    : await tryCreateFastEmbedEmbedder({ modelsDir: defaultModelsDir() });
  if (embedder === null) {
    console.error(
      'eval: the production embedding model could not be loaded (download ' +
        'blocked?). Fix connectivity or run TEAMBRAIN_EVAL_OFFLINE=1 for a ' +
        'plumbing-only pass.',
    );
    process.exitCode = 2;
    return;
  }
  if (offline) {
    console.log(
      'NOTE: offline mode — HashingEmbedder stands in for bge-small; these ' +
        'numbers do not measure production retrieval quality.\n',
    );
  }

  const report = await runEval({
    corpusDir: CORPUS_DIR,
    queries,
    embedder,
    corpusLabel: 'eval-corpus (dogfood + fixture brains)',
  });
  console.log(renderEvalReport(report));
}

main().catch((err: unknown) => {
  console.error('eval crashed:', err);
  process.exitCode = 1;
});
